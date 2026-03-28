import Foundation
import Speech

// macOS speech-to-text helper using SFSpeechRecognizer.
// Receives raw 32-bit float PCM audio (mono, 16kHz) on stdin.
// Outputs JSON transcription results to stdout.
//
// Protocol (line-based JSON on stdout):
//   {"type":"partial","text":"heard so far..."}
//   {"type":"final","text":"complete sentence."}
//   {"type":"error","message":"description"}
//   {"type":"ready"}

func emit(type: String, text: String? = nil, message: String? = nil) {
    var dict: [String: String] = ["type": type]
    if let text = text { dict["text"] = text }
    if let message = message { dict["message"] = message }
    if let data = try? JSONSerialization.data(withJSONObject: dict),
       let json = String(data: data, encoding: .utf8) {
        FileHandle.standardOutput.write((json + "\n").data(using: .utf8)!)
    }
}

class STTHelper {
    var recognizer: SFSpeechRecognizer?
    var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    var recognitionTask: SFSpeechRecognitionTask?
    let sampleRate: Double = 16000
    let stdinQueue = DispatchQueue(label: "stdin-reader")

    init() {
        recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    }

    func start() {
        SFSpeechRecognizer.requestAuthorization { status in
            DispatchQueue.main.async {
                switch status {
                case .authorized:
                    self.beginRecognition()
                case .denied:
                    emit(type: "error", message: "Speech recognition denied. Enable in System Settings > Privacy > Speech Recognition.")
                case .restricted:
                    emit(type: "error", message: "Speech recognition restricted")
                case .notDetermined:
                    emit(type: "error", message: "Speech recognition not determined")
                @unknown default:
                    emit(type: "error", message: "Unknown authorization status")
                }
            }
        }
    }

    func beginRecognition() {
        guard let recognizer = recognizer, recognizer.isAvailable else {
            emit(type: "error", message: "Speech recognizer not available")
            return
        }

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        recognitionRequest = request

        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            if let result = result {
                let text = result.bestTranscription.formattedString
                if result.isFinal {
                    emit(type: "final", text: text)
                    // Restart recognition for continuous listening
                    self?.recognitionRequest = nil
                    self?.recognitionTask = nil
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                        self?.beginRecognition()
                    }
                } else {
                    emit(type: "partial", text: text)
                }
            }

            if let error = error {
                let nsError = error as NSError
                // 1110 = no speech detected, 216 = request cancelled — both normal
                if nsError.code != 1110 && nsError.code != 216 {
                    emit(type: "error", message: error.localizedDescription)
                }
                // Restart on any error
                self?.recognitionRequest = nil
                self?.recognitionTask = nil
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                    self?.beginRecognition()
                }
            }
        }

        emit(type: "ready")

        // Read PCM audio from stdin and feed to the recognition request
        stdinQueue.async { [weak self] in
            self?.readStdinLoop(request: request)
        }
    }

    func readStdinLoop(request: SFSpeechAudioBufferRecognitionRequest) {
        guard let format = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                                          sampleRate: sampleRate,
                                          channels: 1,
                                          interleaved: false) else {
            emit(type: "error", message: "Could not create audio format")
            return
        }

        let stdin = FileHandle.standardInput
        let bytesPerFrame = 4  // Float32 = 4 bytes
        let framesPerChunk = 4096
        let chunkSize = framesPerChunk * bytesPerFrame

        while true {
            let data = stdin.readData(ofLength: chunkSize)
            if data.isEmpty {
                // stdin closed
                request.endAudio()
                break
            }

            let frameCount = UInt32(data.count / bytesPerFrame)
            guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else {
                continue
            }
            buffer.frameLength = frameCount

            data.withUnsafeBytes { rawPtr in
                if let srcPtr = rawPtr.baseAddress {
                    memcpy(buffer.floatChannelData![0], srcPtr, data.count)
                }
            }

            request.append(buffer)
        }
    }
}

signal(SIGINT) { _ in exit(0) }
signal(SIGTERM) { _ in exit(0) }
signal(SIGPIPE) { _ in exit(0) }

let helper = STTHelper()
helper.start()

RunLoop.main.run()
