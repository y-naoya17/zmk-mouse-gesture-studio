# Copyright (c) 2024 The ZMK Contributors
# SPDX-License-Identifier: MIT

if(CONFIG_ZMK_MOUSE_GESTURE)
  target_include_directories(app PRIVATE include)

  if ((NOT CONFIG_ZMK_SPLIT) OR CONFIG_ZMK_SPLIT_ROLE_CENTRAL)
    target_sources_ifdef(CONFIG_ZMK_MOUSE_GESTURE app PRIVATE
      src/behaviors/behavior_mouse_gesture.c
      src/events/mouse_gesture_state_changed.c
      src/input_processors/input_processor_mouse_gesture.c
    )

    if(CONFIG_ZMK_MOUSE_GESTURE_STUDIO_RPC)
      file(GLOB_RECURSE STUDIO_C_FILES ${CMAKE_CURRENT_SOURCE_DIR}/src/studio/*.c)
      target_sources(app PRIVATE ${STUDIO_C_FILES})

      list(APPEND CMAKE_MODULE_PATH ${ZEPHYR_BASE}/modules/nanopb)
      include(nanopb)
      set(NANOPB_GENERATE_CPP_APPEND_PATH TRUE)
      set(NANOPB_GENERATE_CPP_STANDALONE OFF)

      zephyr_library()
      file(GLOB_RECURSE PROTO_FILES ${CMAKE_CURRENT_SOURCE_DIR}/proto/*.proto)
      nanopb_generate_cpp(proto_srcs proto_hdrs RELPATH ${CMAKE_CURRENT_SOURCE_DIR} ${PROTO_FILES})
      target_include_directories(${ZEPHYR_CURRENT_LIBRARY} PUBLIC ${CMAKE_CURRENT_BINARY_DIR})
      target_sources(${ZEPHYR_CURRENT_LIBRARY} PRIVATE ${proto_srcs} ${proto_hdrs})

      target_include_directories(app PUBLIC ${CMAKE_CURRENT_BINARY_DIR}/proto)
      add_dependencies(app ${ZEPHYR_CURRENT_LIBRARY})
    endif()
  endif()
endif()
