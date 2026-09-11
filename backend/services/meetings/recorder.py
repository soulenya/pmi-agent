"""
System-audio recorder for meeting capture.

Captures the machine's speaker output (loopback = the other participants) AND
the default microphone (the local user) on two background threads, then mixes
them to a single 16 kHz mono WAV on stop — exactly the format Google STT v2
ingests most cleanly.

Audio capture relies on WASAPI loopback, which the ``soundcard`` library exposes
on **Windows**. On macOS/Linux loopback needs a virtual audio device
(e.g. BlackHole), so capture is treated as unsupported there and the caller
degrades to detect-only.
"""

from __future__ import annotations

import io
import logging
import sys
import threading
import time
import wave

import numpy as np

logger = logging.getLogger(__name__)

SAMPLE_RATE = 16_000          # 16 kHz mono — STT-friendly, compact
_CHANNELS = 1
_BLOCK_FRAMES = SAMPLE_RATE // 2   # record in ~0.5 s blocks so stop is responsive


def is_capture_supported() -> bool:
    """True only where reliable system-audio loopback capture is available."""
    return sys.platform == "win32"


class _DeviceStream:
    """Records one ROLE — the default speaker's loopback, or the default
    microphone — on its own thread, and follows the default device.

    A stream bound to one physical device goes silent the moment the person
    switches from speakers to a headset mid-call (Windows moves the default;
    the old device keeps "playing" nothing). So every couple of seconds the
    thread asks which device is the default now and, if it changed, closes the
    old recorder and opens the new one, appending to the same frame list. A
    device error (unplugged headset) is handled the same way: log, wait,
    reopen — never end the recording.
    """

    _RECHECK_SECONDS = 2.0
    _RETRY_SECONDS = 1.0

    def __init__(self, role: str, max_frames: int) -> None:
        self._role = role                    # "loopback" | "mic"
        self._label = role
        self._max_frames = max_frames
        self._frames: list[np.ndarray] = []
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name=f"rec-{role}", daemon=True)
        self.error: str | None = None
        self.device_name: str = ""
        self.switches: int = 0

    def start(self) -> None:
        self._thread.start()

    def _resolve(self):
        """The soundcard device for this role as of right now."""
        import soundcard as sc

        if self._role == "loopback":
            speaker = sc.default_speaker()
            return sc.get_microphone(str(speaker.name), include_loopback=True), str(speaker.name)
        mic = sc.default_microphone()
        return mic, str(mic.name)

    def _default_changed(self) -> bool:
        try:
            _, name = self._resolve()
        except Exception:  # noqa: BLE001 — enumeration hiccup; keep the current stream
            return False
        return name != self.device_name

    def _run(self) -> None:
        captured = 0
        while not self._stop.is_set():
            try:
                device, name = self._resolve()
            except Exception as exc:  # noqa: BLE001 — no device right now; try again shortly
                self.error = str(exc)
                logger.warning("No %s device available: %s", self._label, exc)
                self._stop.wait(self._RETRY_SECONDS)
                continue
            if self.device_name and name != self.device_name:
                self.switches += 1
                logger.info("Recorder %s following default device: %s -> %s", self._label, self.device_name, name)
            self.device_name = name
            self.error = None
            last_check = time.monotonic()
            try:
                with device.recorder(samplerate=SAMPLE_RATE, channels=_CHANNELS) as rec:
                    while not self._stop.is_set():
                        data = rec.record(numframes=_BLOCK_FRAMES)
                        if data.ndim > 1:           # (frames, channels) -> mono
                            data = data[:, 0]
                        self._frames.append(np.asarray(data, dtype=np.float32))
                        captured += len(data)
                        if captured >= self._max_frames:
                            logger.warning("Recorder %s hit max length cap", self._label)
                            return
                        now = time.monotonic()
                        if now - last_check >= self._RECHECK_SECONDS:
                            last_check = now
                            if self._default_changed():
                                break                 # reopen on the new default
            except Exception as exc:                # noqa: BLE001 — device errors must not crash the app
                self.error = str(exc)
                logger.warning("Audio stream %s failed (%s); reopening", self._label, exc)
                self._stop.wait(self._RETRY_SECONDS)

    def drain(self) -> np.ndarray:
        """Take everything captured so far WITHOUT stopping (live chunking).

        List swap is atomic under the GIL; the recording thread keeps
        appending to the fresh list.
        """
        frames, self._frames = self._frames, []
        if not frames:
            return np.zeros(0, dtype=np.float32)
        return np.concatenate(frames)

    def stop(self) -> np.ndarray:
        self._stop.set()
        self._thread.join(timeout=5)
        if not self._frames:
            return np.zeros(0, dtype=np.float32)
        return np.concatenate(self._frames)


def _to_wav(pcm: np.ndarray) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(_CHANNELS)
        wf.setsampwidth(2)              # 16-bit PCM
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(pcm.tobytes())
    return buf.getvalue()


class MeetingRecorder:
    """Thread-safe recorder. Captures speaker-loopback + microphone, mixes on stop."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._streams: list[_DeviceStream] = []
        self._recording = False
        self._started_at: float | None = None

    @property
    def recording(self) -> bool:
        return self._recording

    @property
    def started_at(self) -> float | None:
        return self._started_at

    def start(self, max_seconds: int) -> bool:
        """Begin capture. Returns True if at least one device started recording."""
        with self._lock:
            if self._recording:
                return True
            if not is_capture_supported():
                logger.info("Audio capture unsupported on %s — detect-only", sys.platform)
                return False

            try:
                import soundcard  # noqa: F401 — the streams import it themselves; fail early if absent
            except Exception as exc:            # noqa: BLE001
                logger.warning("soundcard unavailable: %s", exc)
                return False

            max_frames = max(1, max_seconds) * SAMPLE_RATE
            # Each stream follows its ROLE's default device from here on, so a
            # missing device now is a warning, not a lost recording.
            streams = [
                _DeviceStream("loopback", max_frames),   # everything you hear (the remote participants)
                _DeviceStream("mic", max_frames),        # the local user's voice
            ]
            for stream in streams:
                stream.start()
            self._streams = streams
            self._recording = True
            self._started_at = time.time()
            logger.info("Meeting recording started (%d device stream(s))", len(streams))
            return True

    def stop(self) -> bytes | None:
        """Stop capture and return mixed 16 kHz mono WAV bytes (or None if empty).

        When live chunking drained audio earlier, this returns only the TAIL
        since the last drain — the caller reassembles the full meeting from
        its saved chunks plus this tail.
        """
        with self._lock:
            if not self._recording:
                return None
            streams = self._streams
            self._streams = []
            self._recording = False
            self._started_at = None

        arrays = [s.stop() for s in streams]
        arrays = [a for a in arrays if a.size > 0]
        if not arrays:
            logger.info("Meeting recording produced no audio")
            return None

        length = max(len(a) for a in arrays)
        mixed = np.zeros(length, dtype=np.float32)
        for a in arrays:
            if len(a) < length:
                a = np.pad(a, (0, length - len(a)))
            mixed += a

        # Sum can exceed [-1, 1] when both sides talk; clip rather than rescale
        # so quiet passages stay audible.
        np.clip(mixed, -1.0, 1.0, out=mixed)
        pcm = (mixed * 32767.0).astype(np.int16)
        logger.info("Meeting recording stopped: %.1f s of audio", length / SAMPLE_RATE)
        return _to_wav(pcm)

    def drain_chunk(self) -> bytes | None:
        """Mix and return the audio captured since the last drain, WITHOUT
        stopping the recording (live-transcription chunks). None when nothing
        meaningful was captured (< 0.5 s)."""
        with self._lock:
            if not self._recording:
                return None
            arrays = [s.drain() for s in self._streams]
        arrays = [a for a in arrays if a.size > 0]
        if not arrays:
            return None
        length = max(len(a) for a in arrays)
        if length < SAMPLE_RATE // 2:
            return None
        mixed = np.zeros(length, dtype=np.float32)
        for a in arrays:
            if len(a) < length:
                a = np.pad(a, (0, length - len(a)))
            mixed += a
        np.clip(mixed, -1.0, 1.0, out=mixed)
        pcm = (mixed * 32767.0).astype(np.int16)
        return _to_wav(pcm)
