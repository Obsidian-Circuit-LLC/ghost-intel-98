Vosk offline speech model (operator-supplied)
=============================================

The AI Assistant's voice conversation (push-to-talk + hands-free) uses Vosk for OFFLINE,
on-device speech-to-text — chosen over Chromium's built-in speech recognition because that one
streams microphone audio to Google's cloud, which would violate the no-cloud rule.

The ~50 MB model is NOT vendored in this repo. To enable voice INPUT, place a Vosk model here as:

    resources/vosk/model.tar.gz

A good small English model is `vosk-model-small-en-us-0.15` from https://alphacephei.com/vosk/models
(Apache-2.0). vosk-browser fetches + unpacks a .tar.gz, so package the model directory as
model.tar.gz (e.g. on the model folder:  tar czf model.tar.gz -C vosk-model-small-en-us-0.15 .
— such that the model files are at the archive root, not nested under the folder name).

This whole directory ships via electron-builder `extraResources` (-> resources/vosk in the packaged
app) and is served to the renderer by the in-app `ga98model://` protocol (no file leaves the box).
Until a model is present, the AI Assistant shows "Voice input needs a Vosk model…" and voice INPUT
is disabled; text chat and speak-aloud (TTS) work without it.

Verify the model's license terms before bundling it in a published installer.
