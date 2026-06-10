"""Voice services — Google Cloud Speech-to-Text and Text-to-Speech.

Both APIs are called with the Google Cloud API key stored in the OS keyring
under the "google" provider (Settings → Voice). No audio is persisted —
requests are proxied straight through and the response returned to the client.
"""
