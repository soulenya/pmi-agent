"""Invitations that arrive by mail name their attendees in the iCalendar part."""

from __future__ import annotations

from services.google_service import _find_ical_part, parse_ical_invite

ICS = (
    "BEGIN:VCALENDAR\r\n"
    "METHOD:REQUEST\r\n"
    "BEGIN:VEVENT\r\n"
    "SUMMARY:PMI/Hatch contract review\r\n"
    "DTSTART:20261030T150000Z\r\n"
    "ORGANIZER;CN=Joe Smith:mailto:joe@hatch.co\r\n"
    "ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;CN=Morgan Keane\r\n"
    " ;X-NUM-GUESTS=0:mailto:morgan@example.com\r\n"
    "ATTENDEE;CN=\"Hoefer, Matthew\":mailto:matthew.hoefer@hatch.co\r\n"
    "ATTENDEE;CN=Lindsey:mailto:lindsey@example.com\r\n"
    "END:VEVENT\r\n"
    "END:VCALENDAR\r\n"
)


def test_attendees_names_and_start_are_read_including_folded_lines():
    facts = parse_ical_invite(ICS)
    assert facts["title"] == "PMI/Hatch contract review"
    assert facts["start"] == "2026-10-30T15:00:00+00:00"
    assert facts["organizer"] == "joe@hatch.co"
    by_email = {a["email"]: a["name"] for a in facts["attendees"]}
    assert by_email == {
        "joe@hatch.co": "Joe Smith",
        "morgan@example.com": "Morgan Keane",  # folded across two lines
        "matthew.hoefer@hatch.co": "Hoefer, Matthew",  # quoted CN with a comma
        "lindsey@example.com": "Lindsey",
    }


def test_all_day_and_local_times_do_not_break():
    assert parse_ical_invite("BEGIN:VEVENT\nDTSTART;VALUE=DATE:20261101\nEND:VEVENT")["start"] == "2026-11-01"
    assert parse_ical_invite("DTSTART;TZID=America/New_York:20261030T110000")["start"] == "2026-10-30T11:00:00"
    assert parse_ical_invite("garbage")["attendees"] == []
    assert parse_ical_invite("")["title"] == ""


def test_calendar_part_is_found_wherever_gmail_nests_it():
    import base64

    data = base64.urlsafe_b64encode(ICS.encode()).decode()
    payload = {
        "mimeType": "multipart/mixed",
        "parts": [
            {"mimeType": "multipart/alternative", "parts": [
                {"mimeType": "text/plain", "body": {"data": "aGk="}},
                {"mimeType": "text/calendar", "body": {"data": data}},
            ]},
            {"mimeType": "application/ics", "filename": "invite.ics", "body": {"attachmentId": "x"}},
        ],
    }
    assert "PMI/Hatch contract review" in _find_ical_part(payload)
    assert _find_ical_part({"mimeType": "text/plain", "body": {"data": "aGk="}}) == ""
