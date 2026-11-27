#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_events/juce_events.h>
#include <juce_gui_basics/juce_gui_basics.h>

#include <array>
#include <atomic>
#include <cerrno>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <sys/socket.h>
#include <thread>
#include <unistd.h>
#include <vector>

namespace {
constexpr int kBlockSize = 256, kMaxFrames = 2048, kParameterPage = 64;
constexpr double kMaxTailSeconds = 10.0, kSilence = 0.00031622777;

bool readFully (int fd, void* destination, size_t size) {
    auto* data = static_cast<char*> (destination);
    while (size != 0) {
        const auto read = ::read (fd, data, size);
        if (read == 0) return false;
        if (read < 0) { if (errno == EINTR) continue; return false; }
        data += read; size -= static_cast<size_t> (read);
    }
    return true;
}

bool writeFully (int fd, const void* source, size_t size) {
    const auto* data = static_cast<const char*> (source);
    while (size != 0) {
        const auto written = ::write (fd, data, size);
        if (written < 0) { if (errno == EINTR) continue; return false; }
        data += written; size -= static_cast<size_t> (written);
    }
    return true;
}

juce::var message (int id) {
    auto result = juce::var (new juce::DynamicObject());
    result.getDynamicObject()->setProperty ("id", id);
    return result;
}

class Vst3Host;
class PluginWindow final : public juce::DocumentWindow {
public:
    PluginWindow (Vst3Host&, juce::AudioProcessorEditor*);
    void closeButtonPressed() override;
private: Vst3Host& host;
};

struct Request { int id = 0; juce::String command; juce::var body; };

class Vst3Host {
public:
    Vst3Host() {
        formats.addFormat (new juce::VST3PluginFormat());
        if (const auto* text = std::getenv ("DECKSYNTH_LIVE_FD")) liveFd = std::atoi (text);
    }
    ~Vst3Host() { stopLive(); closeEditor(); }

    void run() {
        sendReady(); inputThread = std::thread ([this] { readRequests(); });
        while (running) { dispatchRequests(); juce::MessageManager::getInstance()->runDispatchLoopUntil (10); }
        stopLive(); closeEditor(); if (inputThread.joinable()) inputThread.join();
    }
    void closeEditorFromWindow() {
        // Defer destruction until JUCE has returned from closeButtonPressed().
        juce::MessageManager::callAsync ([this] { closeEditor(); });
    }

private:
    juce::AudioPluginFormatManager formats;
    std::unique_ptr<juce::AudioPluginInstance> instance;
    std::unique_ptr<PluginWindow> editorWindow;
    double sampleRate = 48000.0;
    bool instrument = false;
    int liveFd = -1, editorRequest = 0;
    std::atomic<bool> running { true }, liveRunning { false };
    std::thread inputThread, liveThread;
    std::mutex requestsLock, outputLock;
    std::vector<Request> requests;
    // Live render buffers, sized once when Live starts: the live thread never allocates per block.
    juce::AudioBuffer<float> liveAudio; juce::MidiBuffer liveMidi; std::vector<float> liveInterleaved;

    void send (const juce::var& body) {
        const std::lock_guard<std::mutex> guard (outputLock);
        std::cout << juce::JSON::toString (body, true).toStdString() << '\n' << std::flush;
    }
    void sendError (int id, const juce::String& text) {
        auto body = message (id); body.getDynamicObject()->setProperty ("error", text); send (body);
    }
    void sendReady() {
        auto body = message (0); body.getDynamicObject()->setProperty ("ready", true);
        body.getDynamicObject()->setProperty ("version", "juce-vst3"); send (body);
    }

    void readRequests() {
        std::string line;
        while (std::getline (std::cin, line)) {
            const auto body = juce::JSON::parse (juce::String::fromUTF8 (line.c_str()));
            const auto* object = body.getDynamicObject(); if (object == nullptr) continue;
            Request request; request.id = static_cast<int> (object->getProperty ("id"));
            request.command = object->getProperty ("cmd").toString(); request.body = body;
            const std::lock_guard<std::mutex> guard (requestsLock); requests.push_back (std::move (request));
        }
        running = false;
    }
    void dispatchRequests() {
        std::vector<Request> pending;
        { const std::lock_guard<std::mutex> guard (requestsLock); pending.swap (requests); }
        for (const auto& request : pending) try {
            if (request.command == "quit") { running = false; continue; }
            if (request.command == "load") load (request);
            else if (request.command == "set") setParameter (request);
            else if (request.command == "params") sendParameters (request.id, request.body);
            else if (request.command == "render") render (request);
            else if (request.command == "live_enable") enableLive (request);
            else if (request.command == "live_disable") disableLive (request.id);
            else if (request.command == "editor") openEditor (request.id);
            else if (request.command == "editor_close") closeEditor();
            else sendError (request.id, "Unknown plugin command");
        } catch (const std::exception& error) { sendError (request.id, error.what()); }
    }
    juce::AudioProcessor& needInstance() {
        if (instance == nullptr) throw std::runtime_error ("Load a plugin first"); return *instance;
    }

    void load (const Request& request) {
        const auto* body = request.body.getDynamicObject(); const auto path = body->getProperty ("path").toString();
        if (path.isEmpty()) throw std::runtime_error ("Choose a VST3 plugin");
        const auto requestedRate = static_cast<double> (body->getProperty ("rate"));
        if (requestedRate >= 8000.0 && requestedRate <= 192000.0) sampleRate = requestedRate;
        stopLive(); closeEditor(); instance.reset();
        juce::OwnedArray<juce::PluginDescription> found;
        for (auto* format : formats.getFormats()) if (format->getName() == "VST3") format->findAllTypesForFile (found, path);
        if (found.isEmpty()) throw std::runtime_error ("VST3 scan found no plugin");
        juce::String error; instance = formats.createPluginInstance (*found[0], sampleRate, kBlockSize, error);
        if (instance == nullptr) throw std::runtime_error (error.isNotEmpty() ? error.toStdString() : "VST3 could not be opened");
        instance->setPlayConfigDetails (0, 2, sampleRate, kBlockSize); instance->prepareToPlay (sampleRate, kBlockSize);
        auto reply = message (request.id); auto* object = reply.getDynamicObject();
        object->setProperty ("ok", true); object->setProperty ("name", instance->getName());
        object->setProperty ("vendor", found[0]->manufacturerName);
        object->setProperty ("kind", found[0]->isInstrument ? "instrument" : "effect");
        instrument = found[0]->isInstrument;
        appendParameters (*object, request.body); send (reply);
    }
    bool includeParameter (const juce::AudioProcessorParameter& parameter) const {
        const auto name = parameter.getName (60);
        return ! name.startsWithIgnoreCase ("MIDI CC ") && ! name.startsWithIgnoreCase ("MIDI Channel ");
    }
    void appendParameters (juce::DynamicObject& reply, const juce::var& request) const {
        const auto* body = request.getDynamicObject();
        const auto offset = body == nullptr ? 0 : juce::jmax (0, static_cast<int> (body->getProperty ("offset")));
        const auto query = body == nullptr ? juce::String() : body->getProperty ("query").toString().trim().toLowerCase();
        juce::Array<juce::var> page; int matched = 0; const auto parameters = instance->getParameters();
        for (int index = 0; index < parameters.size(); ++index) {
            const auto* parameter = parameters[index]; if (! includeParameter (*parameter)) continue;
            const auto name = parameter->getName (60); if (query.isNotEmpty() && ! name.toLowerCase().contains (query)) continue;
            if (matched++ < offset || page.size() >= kParameterPage) continue;
            auto item = juce::var (new juce::DynamicObject()); auto* object = item.getDynamicObject(); const auto steps = parameter->getNumSteps();
            object->setProperty ("i", index); object->setProperty ("name", name); object->setProperty ("raw", parameter->getValue());
            object->setProperty ("text", parameter->getCurrentValueAsText().substring (0, 40)); object->setProperty ("label", parameter->getLabel().substring (0, 12));
            if (parameter->isBoolean()) object->setProperty ("kind", "switch");
            else if (steps >= 2 && steps <= 8) {
                object->setProperty ("kind", "options"); juce::Array<juce::var> options;
                for (int step = 0; step < steps; ++step) options.add (parameter->getText (static_cast<float> (step) / static_cast<float> (steps - 1), 24));
                object->setProperty ("options", options);
            } else object->setProperty ("kind", "value");
            page.add (item);
        }
        reply.setProperty ("params", page); reply.setProperty ("parameter_count", matched); reply.setProperty ("parameter_offset", offset);
    }
    void sendParameters (int id, const juce::var& request) {
        needInstance(); auto reply = message (id); reply.getDynamicObject()->setProperty ("ok", true);
        appendParameters (*reply.getDynamicObject(), request); send (reply);
    }
    void setParameter (const Request& request) {
        const auto* body = request.body.getDynamicObject(); const auto index = static_cast<int> (body->getProperty ("index"));
        const auto raw = static_cast<float> (body->getProperty ("raw")); auto& processor = needInstance(); const auto parameters = processor.getParameters();
        if (index < 0 || index >= parameters.size() || ! std::isfinite (raw) || raw < 0.0f || raw > 1.0f) throw std::runtime_error ("Invalid parameter value");
        auto* parameter = parameters[index]; parameter->beginChangeGesture(); parameter->setValueNotifyingHost (raw); parameter->endChangeGesture();
        auto reply = message (request.id); reply.getDynamicObject()->setProperty ("ok", true); reply.getDynamicObject()->setProperty ("i", index);
        reply.getDynamicObject()->setProperty ("raw", parameter->getValue()); reply.getDynamicObject()->setProperty ("text", parameter->getCurrentValueAsText().substring (0, 40)); send (reply);
    }
    void render (const Request& request) {
        auto& processor = needInstance();
        if (! instrument) throw std::runtime_error ("Offline takes for Windows effects are not available yet");
        const auto* body = request.body.getDynamicObject();
        const auto path = body->getProperty ("path").toString();
        const auto hold = static_cast<double> (body->getProperty ("hold"));
        const auto rate = static_cast<double> (body->getProperty ("rate"));
        const auto* notes = body->getProperty ("notes").getArray();
        if (! path.endsWithIgnoreCase (".wav") || notes == nullptr || notes->isEmpty() || hold < .02 || hold > 60. || rate < 8000. || rate > 192000.)
            throw std::runtime_error ("Invalid instrument take");
        std::vector<std::pair<int, int>> played;
        for (const auto& item : *notes) {
            const auto* note = item.getDynamicObject(); if (note == nullptr) throw std::runtime_error ("Invalid note");
            const auto pitch = static_cast<int> (note->getProperty ("note"));
            const auto velocity = static_cast<int> (note->getProperty ("velocity"));
            if (pitch < 0 || pitch > 127 || velocity < 1 || velocity > 127) throw std::runtime_error ("Invalid note");
            played.emplace_back (pitch, velocity);
        }
        if (rate != sampleRate) { processor.releaseResources(); sampleRate = rate; processor.setPlayConfigDetails (0, 2, rate, kBlockSize); processor.prepareToPlay (rate, kBlockSize); }
        processor.reset();
        const auto holdFrames = static_cast<int> (std::round (hold * rate));
        const auto capacity = holdFrames + static_cast<int> (std::round (kMaxTailSeconds * rate));
        juce::AudioBuffer<float> result (2, capacity); result.clear();
        int framesWritten = 0, lastLoud = holdFrames; float peak = 0.0f;
        for (int start = 0; start < capacity; start += kBlockSize) {
            const auto frames = juce::jmin (kBlockSize, capacity - start);
            juce::AudioBuffer<float> block (2, frames); block.clear(); juce::MidiBuffer midi;
            if (start == 0) for (const auto& [pitch, velocity] : played) midi.addEvent (juce::MidiMessage::noteOn (1, pitch, static_cast<float> (velocity) / 127.0f), 0);
            if (start <= holdFrames && holdFrames < start + frames)
                for (const auto& [pitch, velocity] : played) midi.addEvent (juce::MidiMessage::noteOff (1, pitch), holdFrames - start);
            { const juce::ScopedLock lock (processor.getCallbackLock()); processor.processBlock (block, midi); }
            for (int channel = 0; channel < 2; ++channel) result.copyFrom (channel, start, block, channel, 0, frames);
            for (int frame = 0; frame < frames; ++frame) {
                const auto level = juce::jmax (std::abs (block.getSample (0, frame)), std::abs (block.getSample (1, frame)));
                peak = juce::jmax (peak, level); if (level > kSilence) lastLoud = start + frame;
            }
            framesWritten = start + frames;
            if (start >= holdFrames && start > lastLoud + static_cast<int> (rate * .05)) { framesWritten = juce::jmax (holdFrames, lastLoud + static_cast<int> (rate * .05)); break; }
        }
        if (peak <= kSilence) throw std::runtime_error ("The plugin made no sound (is it missing a preset?)");
        auto stream = juce::File (path).createOutputStream(); if (stream == nullptr) throw std::runtime_error ("Could not create the take WAV");
        juce::WavAudioFormat wav;
        std::unique_ptr<juce::AudioFormatWriter> writer (wav.createWriterFor (stream.release(), rate, 2, 24, {}, 0));
        if (writer == nullptr || ! writer->writeFromAudioSampleBuffer (result, 0, framesWritten)) throw std::runtime_error ("Could not write the take WAV");
        auto reply = message (request.id); reply.getDynamicObject()->setProperty ("ok", true); reply.getDynamicObject()->setProperty ("path", path);
        reply.getDynamicObject()->setProperty ("seconds", static_cast<double> (framesWritten) / rate); reply.getDynamicObject()->setProperty ("peak", peak); reply.getDynamicObject()->setProperty ("clipped", peak >= 1.0f); send (reply);
    }
    void enableLive (const Request& request) {
        needInstance(); if (liveFd < 0) throw std::runtime_error ("Live audio transport is unavailable");
        if (! liveThread.joinable()) {
            liveAudio.setSize (2, kMaxFrames); liveMidi.ensureSize (512 * 16); liveInterleaved.assign (static_cast<size_t> (kMaxFrames) * 2, 0.0f);
            liveRunning = true; liveThread = std::thread ([this] { renderLive(); });
        }
        else if (! liveRunning) throw std::runtime_error ("Live renderer stopped");
        auto reply = message (request.id); reply.getDynamicObject()->setProperty ("ok", true); reply.getDynamicObject()->setProperty ("live", true); send (reply);
    }
    // Decksynth stops sending blocks while Live is off; the live thread stays for the next time.
    void disableLive (int id) { auto reply = message (id); reply.getDynamicObject()->setProperty ("ok", true); reply.getDynamicObject()->setProperty ("live", false); send (reply); }
    void stopLive() {
        liveRunning = false;
        if (! liveThread.joinable()) return;
        if (liveFd >= 0) ::shutdown (liveFd, SHUT_RD);
        liveThread.join();
    }
    void renderLive() {
        while (liveRunning) {
            std::array<unsigned char, 8> header {}; if (! readFully (liveFd, header.data(), header.size())) break;
            const auto sequence = static_cast<uint32_t> (header[0]) | (static_cast<uint32_t> (header[1]) << 8) | (static_cast<uint32_t> (header[2]) << 16) | (static_cast<uint32_t> (header[3]) << 24);
            const auto frames = static_cast<int> (header[4] | (header[5] << 8)), count = static_cast<int> (header[6] | (header[7] << 8));
            if (frames <= 0 || frames > kMaxFrames || count > 512) break;
            auto& midi = liveMidi; midi.clear(); bool complete = true;
            for (int event = 0; event < count; ++event) {
                std::array<unsigned char, 5> packet {}; if (! readFully (liveFd, packet.data(), packet.size())) { complete = false; break; }
                const auto offset = static_cast<int> (packet[0] | (packet[1] << 8));
                if (offset < frames && (packet[2] & 0x80) != 0) midi.addEvent (packet.data() + 2, 3, offset);
            }
            if (! complete) break;
            // The buffer keeps its kMaxFrames allocation; only the visible size changes.
            auto& audio = liveAudio; audio.setSize (2, frames, false, false, true); audio.clear();
            try {
                // Every block that arrives is played, also one sent just before live_enable is dispatched: dropping
                // it would lose its MIDI. instance is only replaced by load(), which stops this thread first.
                if (instance != nullptr) { const juce::ScopedLock lock (instance->getCallbackLock()); if (! instance->isSuspended()) instance->processBlock (audio, midi); }
            } catch (...) { break; }  // a throwing plugin ends Live (Decksynth reports it), never the helper
            auto* interleaved = liveInterleaved.data();
            for (int frame = 0; frame < frames; ++frame) {
                const auto left = audio.getSample (0, frame), right = audio.getSample (1, frame);
                interleaved[frame * 2] = std::isfinite (left) ? left : 0.0f; interleaved[frame * 2 + 1] = std::isfinite (right) ? right : 0.0f;
            }
            std::array<unsigned char, 6> reply {{static_cast<unsigned char> (sequence), static_cast<unsigned char> (sequence >> 8), static_cast<unsigned char> (sequence >> 16), static_cast<unsigned char> (sequence >> 24), static_cast<unsigned char> (frames), static_cast<unsigned char> (frames >> 8)}};
            if (! writeFully (liveFd, reply.data(), reply.size()) || ! writeFully (liveFd, interleaved, static_cast<size_t> (frames) * 2 * sizeof (float))) break;
        }
        liveRunning = false; if (liveFd >= 0) ::shutdown (liveFd, SHUT_RDWR);
    }
    void openEditor (int id) {
        auto& processor = needInstance(); if (editorWindow != nullptr) throw std::runtime_error ("The plugin window is already open");
        auto* editor = processor.createEditorIfNeeded(); if (editor == nullptr) throw std::runtime_error ("This plugin has no editor window");
        editorWindow = std::make_unique<PluginWindow> (*this, editor); editorRequest = id;
        auto reply = message (id); reply.getDynamicObject()->setProperty ("ok", true); reply.getDynamicObject()->setProperty ("editor", "open"); send (reply);
    }
    void closeEditor() {
        if (editorWindow == nullptr) return; editorWindow.reset();
        if (editorRequest != 0) { auto reply = message (editorRequest); reply.getDynamicObject()->setProperty ("ok", true); reply.getDynamicObject()->setProperty ("editor", "closed"); appendParameters (*reply.getDynamicObject(), juce::var()); send (reply); editorRequest = 0; }
    }
};

PluginWindow::PluginWindow (Vst3Host& owner, juce::AudioProcessorEditor* editor)
    : DocumentWindow (editor->getName(), juce::Colours::black, DocumentWindow::closeButton), host (owner) {
    setUsingNativeTitleBar (true); setContentOwned (editor, true); centreWithSize (juce::jmax (400, getWidth()), juce::jmax (300, getHeight())); setVisible (true); toFront (true);
}
void PluginWindow::closeButtonPressed() { host.closeEditorFromWindow(); }
} // namespace

int main() { juce::ScopedJuceInitialiser_GUI juce; Vst3Host host; host.run(); return 0; }
