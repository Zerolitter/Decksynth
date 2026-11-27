cmake_minimum_required(VERSION 3.22)
project(decksynth_vst3_host VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(JUCE_DIR "" CACHE PATH "Path to a JUCE source checkout")
if(NOT EXISTS "${JUCE_DIR}/CMakeLists.txt")
  message(FATAL_ERROR "Set -DJUCE_DIR=/path/to/JUCE")
endif()

add_subdirectory("${JUCE_DIR}" JUCE)
juce_add_console_app(decksynth_vst3_host PRODUCT_NAME "Decksynth VST3 Host")
target_sources(decksynth_vst3_host PRIVATE main.cpp)
target_compile_definitions(decksynth_vst3_host PRIVATE
  JUCE_PLUGINHOST_VST3=1 JUCE_MODAL_LOOPS_PERMITTED=1
  JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_REPORT_APP_USAGE=0)
target_link_libraries(decksynth_vst3_host PRIVATE juce::juce_audio_processors juce::juce_audio_formats juce::juce_events juce::juce_gui_basics)
