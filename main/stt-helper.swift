import Foundation
import Speech
import AVFoundation

// Simple speech-to-text helper using macOS SFSpeechRecognizer.
// Reads raw 16-bit PCM audio (16kHz mono) from stdin and writes
// JSON transcription results to stdout.
//
// Protocol (line-based JSON on stdout):
//   {"type":"partial","text":"heard so far..."}
//   {"type":"final","text":"complete sentence."}
//   {"type":"error","message":"description"}
//   {"type":"ready"}

class STTHelper {
    let recognizer: SFSpeechRecognizer
    let audioEngine = AVAudioEngine()
    var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    var recognitionTask: SFSpeechRecognitionTask?

    init?() {
        guard let rec = SFSpeechRecognizer(locale: Locale.current) else {
            Self.emit(type: "error", message: "Speech recognizer not available for locale")
            return nil
        }
        self.recognizer = rec
    }

    func start() {
        SFSpeechRecognizer.requestAuthorization { status in
            switch status {
            case .authorized:
                self.startListening()
            case .denied:
                Self.emit(type: "error", message: "Speech recognition permission denied. Enable in System Settings > Privacy > Speech Recognition.")
            case .restricted:
                Self.emit(type: "error", message: "Speech recognition restricted on this device")
            case .notDetermined:
                Self.emit(type: "error", message: "Speech recognition permission not determined")
            @unknown default:
                Self.emit(type: "error", message: "Unknown authorization status")
            }
        }
    }

    func startListening() {
        recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
        guard let request = recognitionRequest else {
            Self.emit(type: "error", message: "Could not create recognition request")
            return
        }

        request.shouldReportPartialResults = true

        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)

        recognitionTask = recognizer.recognitionTask(with: request) { result, error in
            if let result = result {
                let text = result.bestTranscription.formattedString
                if result.isFinal {
                    Self.emit(type: "final", text: text)
                } else {
                    Self.emit(type: "partial", text: text)
                }
            }

            if let error = error {
                // Error code 1110 = no speech detected (normal, restart)
                let nsError = error as NSError
                if nsError.code == 1110 {
                    // Restart listening after silence
                    self.restartListening()
                    return
                }
                Self.emit(type: "error", message: error.localizedDescription)
            }
        }

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
            request.append(buffer)
        }

        do {
            audioEngine.prepare()
            try audioEngine.start()
            Self.emit(type: "ready")
        } catch {
            Self.emit(type: "error", message: "Audio engine failed to start: \(error.localizedDescription)")
        }
    }

    func restartListening() {
        stopListening()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            self.startListening()
        }
    }

    func stopListening() {
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()
        recognitionRequest = nil
        recognitionTask = nil
    }

    static func emit(type: String, text: String? = nil, message: String? = nil) {
        var dict: [String: String] = ["type": type]
        if let text = text { dict["text"] = text }
        if let message = message { dict["message"] = message }

        if let data = try? JSONSerialization.data(withJSONObject: dict),
           let json = String(data: data, encoding: .utf8) {
            print(json)
            fflush(stdout)
        }
    }
}

// Handle SIGINT/SIGTERM for clean shutdown
signal(SIGINT) { _ in exit(0) }
signal(SIGTERM) { _ in exit(0) }

guard let helper = STTHelper() else {
    exit(1)
}

helper.start()

// Keep the process alive
RunLoop.main.run()
