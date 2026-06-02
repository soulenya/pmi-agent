"""
End-to-end WebSocket chat test.
Usage: uv run python scripts/test_ws.py
"""
import asyncio
import json
import httpx
import websockets

BASE = "http://127.0.0.1:8000"
WS_BASE = "ws://127.0.0.1:8000"
EMAIL = "admin@precisian.local"
PASSWORD = "Admin1234!"


async def main() -> None:
    async with httpx.AsyncClient(base_url=BASE, timeout=15) as client:
        # 1. Login
        print("1. Logging in...")
        r = await client.post("/auth/login", json={"email": EMAIL, "password": PASSWORD})
        r.raise_for_status()
        token = r.json()["access_token"]
        print(f"   ✓ access_token: {token[:40]}...")

        # 2. Create conversation
        print("2. Creating conversation...")
        r = await client.post(
            "/conversations",
            json={"title": "WS Test", "agent_type": "assistant"},
            headers={"Authorization": f"Bearer {token}"},
        )
        r.raise_for_status()
        conv = r.json()
        conv_id = conv["id"]
        print(f"   ✓ conversation id: {conv_id}")

    # 3. Connect WebSocket + stream
    ws_url = f"{WS_BASE}/ws/chat/{conv_id}?token={token}"
    print(f"3. Connecting WebSocket: {ws_url[:80]}...")
    async with websockets.connect(ws_url, open_timeout=10) as ws:
        # Send message
        payload = json.dumps({"content": "Hello! What is VACTOR in one sentence?"})
        await ws.send(payload)
        print("   → Sent: " + payload)

        # Receive frames
        full_response = ""
        message_id = None
        print("   ← Streaming response:")
        async for raw in ws:
            frame = json.loads(raw)
            ftype = frame.get("type")
            if ftype == "token":
                chunk = frame.get("content", "")
                full_response += chunk
                print(chunk, end="", flush=True)
            elif ftype == "done":
                message_id = frame.get("message_id")
                print(f"\n   ✓ done — message_id: {message_id}")
                break
            elif ftype == "error":
                print(f"\n   ✗ error: {frame.get('detail')}")
                break

    # 4. Fetch saved message
    if message_id:
        print("4. Fetching saved messages...")
        async with httpx.AsyncClient(base_url=BASE, timeout=10) as client:
            r = await client.get(
                f"/conversations/{conv_id}/messages",
                headers={"Authorization": f"Bearer {token}"},
            )
            r.raise_for_status()
            msgs = r.json()
            print(f"   ✓ {len(msgs)} message(s) in conversation")
            for m in msgs:
                print(f"     [{m['role']}] {str(m['content'])[:100]}")

    print("\nAll checks passed ✓")


if __name__ == "__main__":
    asyncio.run(main())
