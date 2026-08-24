cmake_minimum_required(VERSION 3.13)

project(appmodules)

include(${REACT_ANDROID_DIR}/cmake-utils/ReactNative-application.cmake)

target_link_libraries(${CMAKE_PROJECT_NAME} c++_shared)

if(DEFINED AUTOLINKED_LIBRARIES)
  foreach(autolinked_library ${AUTOLINKED_LIBRARIES})
    target_link_libraries(${autolinked_library} c++_shared)
  endforeach()
endif()
