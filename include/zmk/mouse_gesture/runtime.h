#pragma once

#include <stdint.h>
#include <zmk/behavior.h>

#define ZMK_MOUSE_GESTURE_RUNTIME_MAX_GESTURES 16
#define ZMK_MOUSE_GESTURE_RUNTIME_MAX_DIRECTIONS 8
#define ZMK_MOUSE_GESTURE_RUNTIME_MAX_BINDINGS 8
#define ZMK_MOUSE_GESTURE_RUNTIME_MAX_ACTIVATION_KEYS 8
#define ZMK_MOUSE_GESTURE_RUNTIME_NAME_LEN 24

struct zmk_mouse_gesture_runtime_binding {
    zmk_behavior_local_id_t local_id;
    uint32_t param1;
    uint32_t param2;
};

struct zmk_mouse_gesture_runtime_gesture {
    char name[ZMK_MOUSE_GESTURE_RUNTIME_NAME_LEN];
    uint8_t pattern_len;
    uint8_t pattern[ZMK_MOUSE_GESTURE_RUNTIME_MAX_DIRECTIONS];
    uint8_t bindings_len;
    struct zmk_mouse_gesture_runtime_binding
        bindings[ZMK_MOUSE_GESTURE_RUNTIME_MAX_BINDINGS];
};

struct zmk_mouse_gesture_runtime_activation_key {
    char name[ZMK_MOUSE_GESTURE_RUNTIME_NAME_LEN];
    uint32_t position;
    uint8_t layer;
    uint32_t tapping_term_ms;
    struct zmk_mouse_gesture_runtime_binding tap;
    struct zmk_mouse_gesture_runtime_binding up;
    struct zmk_mouse_gesture_runtime_binding down;
    struct zmk_mouse_gesture_runtime_binding left;
    struct zmk_mouse_gesture_runtime_binding right;
};

struct zmk_mouse_gesture_runtime_config {
    uint32_t stroke_size;
    uint32_t idle_timeout_ms;
    uint32_t gesture_cooldown_ms;
    uint32_t movement_threshold;
    bool enable_eager_mode;
    bool always_active;
    uint8_t gesture_count;
    struct zmk_mouse_gesture_runtime_gesture
        gestures[ZMK_MOUSE_GESTURE_RUNTIME_MAX_GESTURES];
    uint8_t activation_key_count;
    struct zmk_mouse_gesture_runtime_activation_key
        activation_keys[ZMK_MOUSE_GESTURE_RUNTIME_MAX_ACTIVATION_KEYS];
};

int zmk_mouse_gesture_runtime_get(struct zmk_mouse_gesture_runtime_config *config);
int zmk_mouse_gesture_runtime_set(const struct zmk_mouse_gesture_runtime_config *config);
int zmk_mouse_gesture_runtime_reset(void);
