/*
 * Copyright (c) 2024 The ZMK Contributors
 *
 * SPDX-License-Identifier: MIT
 */

#define DT_DRV_COMPAT zmk_input_processor_mouse_gesture

#include <zephyr/device.h>
#include <zephyr/logging/log.h>
#include <zephyr/kernel.h>
#include <zephyr/input/input.h>
#include <zephyr/sys/util.h>
#include <zephyr/sys/util_macro.h>
#include <drivers/input_processor.h>
#include <stdlib.h>
#include <errno.h>
#include <limits.h>
#include <string.h>
#include <zephyr/settings/settings.h>

#include <zmk/keymap.h>
#include <dt-bindings/zmk/mouse-gesture.h>
#include <zmk/behavior.h>
#include <zmk/behavior_queue.h>
#include <drivers/behavior.h>
#include <zmk/events/mouse_gesture_state_changed.h>
#include <zmk/mouse_gesture/runtime.h>

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

#if DT_HAS_COMPAT_STATUS_OKAY(DT_DRV_COMPAT)

#define MAX_GESTURE_SEQUENCE_LENGTH ZMK_MOUSE_GESTURE_RUNTIME_MAX_DIRECTIONS
#define MAX_GESTURE_PATTERNS ZMK_MOUSE_GESTURE_RUNTIME_MAX_GESTURES
#define MAX_DEFERRED_BINDINGS ZMK_MOUSE_GESTURE_RUNTIME_MAX_BINDINGS
#define MAX_GESTURE_TRIE_NODES (MAX_GESTURE_PATTERNS * MAX_GESTURE_SEQUENCE_LENGTH + 1)
#define MOUSE_GESTURE_SETTINGS_KEY "mouse_gesture/config"
#define MOUSE_GESTURE_SETTINGS_MAGIC 0x4d475354
#define MOUSE_GESTURE_SETTINGS_VERSION 1

struct gesture_node {
    struct gesture_node *child[4];
    const struct gesture_pattern *pattern;
};

struct input_processor_mouse_gesture_data {
    struct k_mutex lock;
    struct k_work_delayable save_work;
    bool is_active;
    bool runtime_config_loaded;
    int32_t acc_x;
    int32_t acc_y;
    uint8_t last_direction;
    int64_t last_gesture_time;
    uint32_t event_count;
    int64_t last_reset_time;
    struct k_work_delayable idle_timeout_work;
    int64_t last_movement_time;
    struct gesture_node *current_node;
    const struct device *dev;

    struct gesture_node gesture_nodes_pool[MAX_GESTURE_TRIE_NODES];
    size_t gesture_nodes_count;
    struct gesture_node *gesture_trie_root;

    struct gesture_pattern runtime_patterns[ZMK_MOUSE_GESTURE_RUNTIME_MAX_GESTURES];
    struct zmk_behavior_binding
        runtime_bindings[ZMK_MOUSE_GESTURE_RUNTIME_MAX_GESTURES]
                        [ZMK_MOUSE_GESTURE_RUNTIME_MAX_BINDINGS];
    uint8_t runtime_sequences[ZMK_MOUSE_GESTURE_RUNTIME_MAX_GESTURES]
                             [ZMK_MOUSE_GESTURE_RUNTIME_MAX_DIRECTIONS];
    size_t runtime_pattern_count;
    uint32_t runtime_stroke_size;
    uint32_t runtime_movement_threshold;
    uint32_t runtime_gesture_cooldown_ms;
    bool runtime_enable_eager_mode;
    bool runtime_always_active;
    uint32_t runtime_idle_timeout_ms;
};

struct persisted_binding {
    zmk_behavior_local_id_t local_id;
    uint32_t param1;
    uint32_t param2;
};

struct persisted_gesture {
    char name[ZMK_MOUSE_GESTURE_RUNTIME_NAME_LEN];
    uint8_t pattern_len;
    uint8_t pattern[ZMK_MOUSE_GESTURE_RUNTIME_MAX_DIRECTIONS];
    uint8_t bindings_len;
    struct persisted_binding bindings[ZMK_MOUSE_GESTURE_RUNTIME_MAX_BINDINGS];
};

struct persisted_config {
    uint32_t magic;
    uint16_t version;
    uint32_t stroke_size;
    uint32_t idle_timeout_ms;
    uint32_t gesture_cooldown_ms;
    uint32_t movement_threshold;
    bool enable_eager_mode;
    bool always_active;
    uint8_t gesture_count;
    struct persisted_gesture gestures[ZMK_MOUSE_GESTURE_RUNTIME_MAX_GESTURES];
};

static struct gesture_node *allocate_gesture_node(struct input_processor_mouse_gesture_data *data) {
    if (data->gesture_nodes_count >= MAX_GESTURE_TRIE_NODES) {
        return NULL;
    }
    struct gesture_node *node = &data->gesture_nodes_pool[data->gesture_nodes_count++];
    memset(node, 0, sizeof(struct gesture_node));
    return node;
}

static int direction_to_index(uint8_t direction) {
    switch (direction) {
    case GESTURE_UP:
        return 0;
    case GESTURE_DOWN:
        return 1;
    case GESTURE_LEFT:
        return 2;
    case GESTURE_RIGHT:
        return 3;
    default:
        return -1;
    }
}

static void build_gesture_trie(struct input_processor_mouse_gesture_data *data, const struct gesture_pattern *patterns, size_t pattern_count);

/* Message queue definitions for gesture execution */
struct gesture_exec_msg {
    const struct device *dev;
    size_t binding_count;
    struct zmk_behavior_binding bindings[MAX_DEFERRED_BINDINGS];
    uint32_t wait_ms;
    uint32_t tap_ms;
};

K_MSGQ_DEFINE(gesture_exec_msgq, sizeof(struct gesture_exec_msg), CONFIG_ZMK_MOUSE_GESTURE_EXEC_MAX_EVENTS, 4);

/* Forward declaration for locked event handler */
static int input_processor_mouse_gesture_handle_event_locked(const struct device *dev,
                                                             struct input_event *event);

static void gesture_exec_work_cb(struct k_work *work);
static K_WORK_DEFINE(gesture_exec_work, gesture_exec_work_cb);

/* State change message queue */
struct state_action_msg {
    const struct device *dev;
    bool activate;
};
K_MSGQ_DEFINE(state_action_msgq, sizeof(struct state_action_msg), 8, 4);

/* Mouse relative movement message queue */
struct mouse_rel_msg {
    const struct device *dev;
    uint16_t code;
    int32_t value;
};

K_MSGQ_DEFINE(mouse_rel_msgq, sizeof(struct mouse_rel_msg), CONFIG_ZMK_MOUSE_GESTURE_REL_QUEUE_LEN, 4);

struct gesture_pattern {
    size_t bindings_len;
    const struct zmk_behavior_binding *bindings;
    size_t pattern_len;
    uint32_t wait_ms;
    uint32_t tap_ms;
    const uint8_t *pattern;
};

static void build_gesture_trie(struct input_processor_mouse_gesture_data *data, const struct gesture_pattern *patterns, size_t pattern_count) {
    if (!data->gesture_trie_root) {
        data->gesture_trie_root = allocate_gesture_node(data);
        if (!data->gesture_trie_root) {
            return;
        }
    }

    for (size_t i = 0; i < pattern_count; i++) {
        const struct gesture_pattern *pat = &patterns[i];
        struct gesture_node *node = data->gesture_trie_root;
        for (size_t j = 0; j < pat->pattern_len; j++) {
            int idx = direction_to_index(pat->pattern[j]);
            if (idx < 0) {
                node = NULL;
                break;
            }
            if (!node->child[idx]) {
                node->child[idx] = allocate_gesture_node(data);
                if (!node->child[idx]) {
                    node = NULL;
                    break;
                }
            }
            node = node->child[idx];
        }
        if (node) {
            node->pattern = pat;
        }
    }
}


struct input_processor_mouse_gesture_config {
    uint32_t stroke_size;
    uint32_t movement_threshold;
    uint32_t gesture_cooldown_ms;  // Cooldown period between gestures
    bool enable_eager_mode;  // Execute bindings immediately when gesture pattern is matched
    bool always_active;
    uint32_t idle_timeout_ms;  // Time to wait for idle before invoking gesture
    uint16_t event_code_x;
    uint16_t event_code_y;
    const struct gesture_pattern *patterns;  // Array of pointers to patterns
    size_t pattern_count;
};

static void schedule_gesture_execution(const struct device *dev, const struct gesture_pattern *pattern);
static void clear_gesture_data_locked(struct input_processor_mouse_gesture_data *data);
static void save_work_handler(struct k_work *work);

static uint32_t effective_stroke_size(const struct device *dev) {
    const struct input_processor_mouse_gesture_config *config = dev->config;
    struct input_processor_mouse_gesture_data *data = dev->data;
    return data->runtime_config_loaded ? data->runtime_stroke_size : config->stroke_size;
}

static uint32_t effective_movement_threshold(const struct device *dev) {
    const struct input_processor_mouse_gesture_config *config = dev->config;
    struct input_processor_mouse_gesture_data *data = dev->data;
    return data->runtime_config_loaded ? data->runtime_movement_threshold
                                       : config->movement_threshold;
}

static uint32_t effective_gesture_cooldown_ms(const struct device *dev) {
    const struct input_processor_mouse_gesture_config *config = dev->config;
    struct input_processor_mouse_gesture_data *data = dev->data;
    return data->runtime_config_loaded ? data->runtime_gesture_cooldown_ms
                                       : config->gesture_cooldown_ms;
}

static bool effective_enable_eager_mode(const struct device *dev) {
    const struct input_processor_mouse_gesture_config *config = dev->config;
    struct input_processor_mouse_gesture_data *data = dev->data;
    return data->runtime_config_loaded ? data->runtime_enable_eager_mode
                                       : config->enable_eager_mode;
}

static bool effective_always_active(const struct device *dev) {
    const struct input_processor_mouse_gesture_config *config = dev->config;
    struct input_processor_mouse_gesture_data *data = dev->data;
    return data->runtime_config_loaded ? data->runtime_always_active : config->always_active;
}

static uint32_t effective_idle_timeout_ms(const struct device *dev) {
    const struct input_processor_mouse_gesture_config *config = dev->config;
    struct input_processor_mouse_gesture_data *data = dev->data;
    return data->runtime_config_loaded ? data->runtime_idle_timeout_ms : config->idle_timeout_ms;
}

static const struct gesture_pattern *effective_patterns(const struct device *dev,
                                                        size_t *pattern_count) {
    const struct input_processor_mouse_gesture_config *config = dev->config;
    struct input_processor_mouse_gesture_data *data = dev->data;
    if (data->runtime_config_loaded) {
        *pattern_count = data->runtime_pattern_count;
        return data->runtime_patterns;
    }
    *pattern_count = config->pattern_count;
    return config->patterns;
}

static void rebuild_gesture_trie_locked(const struct device *dev) {
    struct input_processor_mouse_gesture_data *data = dev->data;
    size_t pattern_count = 0;
    const struct gesture_pattern *patterns = effective_patterns(dev, &pattern_count);

    data->gesture_nodes_count = 0;
    data->gesture_trie_root = NULL;
    build_gesture_trie(data, patterns, pattern_count);
    clear_gesture_data_locked(data);
}

static int direction_is_valid(uint8_t direction) {
    return direction == GESTURE_UP || direction == GESTURE_DOWN || direction == GESTURE_LEFT ||
           direction == GESTURE_RIGHT;
}

static uint8_t detect_direction(int32_t x, int32_t y) {

    if (abs(x) > abs(y)) {
        return GESTURE_X(x);
    } else {
        return GESTURE_Y(y);
    }

    return GESTURE_NONE;
}

// Check if pattern matches and clears gesture data (should be called while mutex is held)
static const struct gesture_pattern *match_gesture_pattern_locked(const struct device *dev, bool clear_even_if_not_matched) {
    struct input_processor_mouse_gesture_data *data = dev->data;
    int64_t current_time = k_uptime_get();

    if (!data->current_node) {
        if (clear_even_if_not_matched) {
            clear_gesture_data_locked(data);
        }
        return NULL;
    }

    const struct gesture_node *node = data->current_node;
    bool has_binding = node->pattern != NULL;
    bool has_child = false;
    for (int i = 0; i < 4; i++) {
        if (node->child[i]) {
            has_child = true;
            break;
        }
    }

    // Exit if no binding found (means no gesture pattern matched)
    if (!has_binding) {
        if (clear_even_if_not_matched) {
            clear_gesture_data_locked(data);
        }
        return NULL;
    }

    if (current_time - data->last_gesture_time < effective_gesture_cooldown_ms(dev)) {
        return NULL;
    }

    // Invoke by idle timeout if duplicate gesture found in eager mode
    if (effective_enable_eager_mode(dev) && has_child && !clear_even_if_not_matched &&
        effective_idle_timeout_ms(dev) > 0) {
        int ret = k_work_reschedule(&data->idle_timeout_work, K_MSEC(effective_idle_timeout_ms(dev)));
        if (ret < 0) {
            LOG_WRN("Failed to reschedule idle timeout work: %d", ret);
        } else {
            LOG_DBG("Idle timeout scheduled for %d ms", effective_idle_timeout_ms(dev));
        }
        return NULL;
    }

    const struct gesture_pattern *pattern = node->pattern;
    data->last_gesture_time = current_time;
    schedule_gesture_execution(dev, pattern);
    clear_gesture_data_locked(data);

    return pattern;
}

// Work queue handler for idle timeout gesture execution
static void idle_timeout_work_handler(struct k_work *work) {
    struct k_work_delayable *delayed_work = k_work_delayable_from_work(work);
    struct input_processor_mouse_gesture_data *data =
        CONTAINER_OF(delayed_work, struct input_processor_mouse_gesture_data, idle_timeout_work);

    const struct device *dev = data->dev;
    if (!dev) {
        return;
    }

    if (k_mutex_lock(&data->lock, K_MSEC(50)) == 0) {
        if (data->is_active && data->current_node && data->current_node != data->gesture_trie_root) {
            match_gesture_pattern_locked(dev, true);
        }
        k_mutex_unlock(&data->lock);
    }
}

/* Primary work handler processing message queues */
static void gesture_exec_work_cb(struct k_work *work) {
    ARG_UNUSED(work);

    struct state_action_msg s_msg;
    while (k_msgq_get(&state_action_msgq, &s_msg, K_NO_WAIT) == 0) {
        const struct device *dev = s_msg.dev;
        if (!dev) {
            continue;
        }
            struct input_processor_mouse_gesture_data *data = dev->data;
            if (k_mutex_lock(&data->lock, K_FOREVER) == 0) {
                bool old_state = data->is_active;
            bool new_state = effective_always_active(dev) ? true : s_msg.activate;
            data->is_active = new_state;
            if (old_state && !new_state) { // Deactivated
                match_gesture_pattern_locked(dev, true);
            } else if (!old_state && new_state) { // activated
                clear_gesture_data_locked(data);
            }
            k_mutex_unlock(&data->lock);
        }
    }

    struct mouse_rel_msg m_msg;
    while (k_msgq_get(&mouse_rel_msgq, &m_msg, K_NO_WAIT) == 0) {
        const struct device *dev = m_msg.dev;
        if (!dev) {
            continue;
        }
        struct input_processor_mouse_gesture_data *data = dev->data;
        if (k_mutex_lock(&data->lock, K_FOREVER) == 0) {
            struct input_event ev = {
                .type = INPUT_EV_REL,
                .code = m_msg.code,
                .value = m_msg.value,
            };
            input_processor_mouse_gesture_handle_event_locked(dev, &ev);
            // Execute gesture pattern matching if eager mode is enabled
            if (effective_enable_eager_mode(dev)) {
                match_gesture_pattern_locked(dev, false);
            }
            k_mutex_unlock(&data->lock);
        }
    }

    /* -------- 2. Gesture execution -------- */
    struct gesture_exec_msg g_msg;
    while (k_msgq_get(&gesture_exec_msgq, &g_msg, K_NO_WAIT) == 0) {
        struct zmk_behavior_binding_event event = {
            .position = INT32_MAX,
            .timestamp = k_uptime_get(),
#if IS_ENABLED(CONFIG_ZMK_SPLIT)
            .source = ZMK_POSITION_STATE_CHANGE_SOURCE_LOCAL,
#endif
        };
        for (size_t k = 0; k < g_msg.binding_count; k++) {
            int ret = zmk_behavior_queue_add(&event, g_msg.bindings[k], true, k * g_msg.wait_ms);
            if (ret < 0) {
                LOG_ERR("Failed to queue press event %zu: %d", k, ret);
                continue;
            }
            ret = zmk_behavior_queue_add(&event, g_msg.bindings[k], false, (k * g_msg.wait_ms) + g_msg.tap_ms);
            if (ret < 0) {
                LOG_ERR("Failed to queue release event %zu: %d", k, ret);
            }
        }
    }

    if (k_msgq_num_used_get(&state_action_msgq) > 0 ||
        k_msgq_num_used_get(&mouse_rel_msgq) > 0 ||
        k_msgq_num_used_get(&gesture_exec_msgq) > 0) {
        k_work_submit(&gesture_exec_work);
    }
}

// Schedule gesture execution via work queue
static void schedule_gesture_execution(const struct device *dev, const struct gesture_pattern *pattern) {
    if (!pattern || pattern->bindings_len == 0) {
        return;
    }

    /* Build execution message */
    struct gesture_exec_msg msg = {0};
    msg.dev = dev;
    msg.binding_count = MIN(pattern->bindings_len, MAX_DEFERRED_BINDINGS);
    memcpy(msg.bindings, pattern->bindings,
           msg.binding_count * sizeof(struct zmk_behavior_binding));
    msg.wait_ms = pattern->wait_ms;
    msg.tap_ms = pattern->tap_ms;

    int ret = k_msgq_put(&gesture_exec_msgq, &msg, K_MSEC(10));
    if (ret < 0) {
        LOG_WRN("Gesture execution queue full – gesture dropped (len=%zu)", msg.binding_count);
        return;
    }

    /* Ensure work item runs */
    k_work_submit(&gesture_exec_work);
}

// Safe accumulation with overflow protection
static int accumulate_movement_safe(int32_t *accumulator, int32_t delta, const char* axis) {
    if ((*accumulator > 0 && delta > INT32_MAX - *accumulator) ||
        (*accumulator < 0 && delta < INT32_MIN - *accumulator)) {
        LOG_WRN("Movement accumulator overflow on %s axis, resetting (acc=%d, delta=%d)",
                axis, *accumulator, delta);
        *accumulator = delta;
        return -EOVERFLOW;
    }

    *accumulator += delta;
    return 0;
}

static int input_processor_mouse_gesture_handle_event_locked(const struct device *dev,
                                                      struct input_event *event) {
    struct input_processor_mouse_gesture_data *data = dev->data;
    int64_t current_time = k_uptime_get();

    // Event loop protection
    if (current_time - data->last_reset_time > 1000) {  // Reset every second
        data->event_count = 0;
        data->last_reset_time = current_time;
    }

    data->event_count++;
    if (data->event_count > 1000) {  // Prevent event loops
        LOG_ERR("Too many events in short time, possible loop detected");
        data->current_node = data->gesture_trie_root;
        data->event_count = 0;
        return ZMK_INPUT_PROC_CONTINUE;
    }

    if (current_time - data->last_gesture_time < effective_gesture_cooldown_ms(dev)) {
        return ZMK_INPUT_PROC_CONTINUE;
    }

    // Check if mouse gesture is active
    if (!data->is_active) {
        data->acc_x = 0;
        data->acc_y = 0;
        data->last_direction = GESTURE_NONE;
        data->current_node = data->gesture_trie_root;
        return ZMK_INPUT_PROC_CONTINUE;
    }

    // Accumulate with overflow protection
    if (event->code == config->event_code_x) {
        accumulate_movement_safe(&data->acc_x, event->value, "X");
    } else if (event->code == config->event_code_y) {
        accumulate_movement_safe(&data->acc_y, event->value, "Y");
    } else {
        // this should never happen
    }

    // Update last movement time and restart idle timer if needed
    data->last_movement_time = current_time;

    // Reschedule idle timeout if configured and not in eager mode
    if (effective_idle_timeout_ms(dev) > 0 && !effective_enable_eager_mode(dev) &&
        data->current_node && data->current_node != data->gesture_trie_root) {
        int ret = k_work_reschedule(&data->idle_timeout_work, K_MSEC(effective_idle_timeout_ms(dev)));
        if (ret < 0) {
            LOG_WRN("Failed to reschedule idle timeout work: %d", ret);
        } else {
            LOG_DBG("Idle timeout scheduled for %d ms", effective_idle_timeout_ms(dev));
        }
    }

    // Accumulate until stroke size is reached
    uint32_t total_distance = abs(data->acc_x) + abs(data->acc_y);

    if (total_distance < effective_stroke_size(dev)) {
        return ZMK_INPUT_PROC_CONTINUE;
    }

    uint8_t direction = detect_direction(data->acc_x, data->acc_y);

    if (direction != GESTURE_NONE) {
        // Ignore duplicate direction
        if (data->last_direction == direction) {
            LOG_DBG("Ignoring duplicate direction %d", direction);
        } else {
            int dir_idx = direction_to_index(direction);
            if (data->current_node && dir_idx >= 0) {
                struct gesture_node *next_node = data->current_node->child[dir_idx];
                if (next_node) {
                    // Start idle timeout if configured and not in eager mode and this is the first direction
                    if (effective_idle_timeout_ms(dev) > 0 && !effective_enable_eager_mode(dev) &&
                        data->current_node == data->gesture_trie_root) {
                        int ret = k_work_reschedule(&data->idle_timeout_work,
                                                    K_MSEC(effective_idle_timeout_ms(dev)));
                        if (ret < 0) {
                            LOG_WRN("Failed to reschedule idle timeout work: %d", ret);
                        } else {
                            LOG_DBG("Idle timeout scheduled for %d ms after first direction",
                                    effective_idle_timeout_ms(dev));
                        }
                    }

                    data->current_node = next_node;
                    data->last_direction = direction;
                    LOG_DBG("Moved to next node for direction %d", direction);
                } else {
                    LOG_DBG("No valid transition for direction %d, clearing gesture", direction);
                    clear_gesture_data_locked(data);
                    return ZMK_INPUT_PROC_CONTINUE;
                }
            } else {
                LOG_DBG("Invalid current node or direction %d, clearing gesture", direction);
                clear_gesture_data_locked(data);
                return ZMK_INPUT_PROC_CONTINUE;
            }
        }

        // Reset accumulation for next direction
        data->acc_x = 0;
        data->acc_y = 0;
    }

    return ZMK_INPUT_PROC_CONTINUE;
}

static int input_processor_mouse_gesture_handle_event(const struct device *dev,
                                                      struct input_event *event,
                                                      uint32_t param1, uint32_t param2,
                                                      struct zmk_input_processor_state *state) {
    ARG_UNUSED(param1);
    ARG_UNUSED(param2);
    ARG_UNUSED(state);

    /* Only care about the configured relative axis events */
    const struct input_processor_mouse_gesture_config *config = dev->config;
    if (!(event->type == INPUT_EV_REL &&
          (event->code == config->event_code_x || event->code == config->event_code_y))) {
        return ZMK_INPUT_PROC_CONTINUE;
    }

    /* Ignore small movements  */
    if (abs(event->value) < effective_movement_threshold(dev)) {
        return ZMK_INPUT_PROC_CONTINUE;
    }

    struct mouse_rel_msg msg = {
        .dev = dev,
        .code = event->code,
        .value = event->value,
    };

    if (k_msgq_put(&mouse_rel_msgq, &msg, K_MSEC(10)) != 0) {
        /* Queue full – drop smallest importance events */
        LOG_WRN("Mouse rel queue full – movement dropped");
    }

    k_work_submit(&gesture_exec_work);

    return ZMK_INPUT_PROC_CONTINUE;
}

static int input_processor_mouse_gesture_init(const struct device *dev) {
    LOG_INF("Mouse gesture input processor init start");

    struct input_processor_mouse_gesture_data *data = dev->data;
    k_mutex_init(&data->lock);
    k_work_init_delayable(&data->idle_timeout_work, idle_timeout_work_handler);
    k_work_init_delayable(&data->save_work, save_work_handler);
    data->dev = dev;
    data->runtime_config_loaded = false;
    data->gesture_nodes_count = 0;
    data->gesture_trie_root = NULL;

    data->is_active = effective_always_active(dev);
    data->acc_x = 0;
    data->acc_y = 0;
    data->last_direction = GESTURE_NONE;
    data->last_gesture_time = 0;
    data->event_count = 0;
    data->last_reset_time = k_uptime_get();

    data->last_movement_time = 0;
    rebuild_gesture_trie_locked(dev);

    LOG_INF("Mouse gesture input processor init done");
    return 0;
}

// Clear gesture data when gesture state changes (called while mutex is held)
static void clear_gesture_data_locked(struct input_processor_mouse_gesture_data *data) {
    data->acc_x = 0;
    data->acc_y = 0;
    data->last_direction = GESTURE_NONE;
    data->current_node = data->gesture_trie_root;

    // Cancel any pending idle timeout
    k_work_cancel_delayable(&data->idle_timeout_work);

    LOG_DBG("Gesture data cleared");
}

// Event listener for mouse gesture state changes
static int mouse_gesture_state_listener(const zmk_event_t *eh) {
    struct zmk_mouse_gesture_state_changed *ev = as_zmk_mouse_gesture_state_changed(eh);
    if (ev == NULL) {
        return ZMK_EV_EVENT_BUBBLE;
    }

#define MOUSE_GESTURE_DEV_ITEM(n) DEVICE_DT_INST_GET(n),
    static const struct device *const mouse_gesture_devs[] = {
        DT_INST_FOREACH_STATUS_OKAY(MOUSE_GESTURE_DEV_ITEM)
    };

    for (size_t i = 0; i < ARRAY_SIZE(mouse_gesture_devs); i++) {
        struct state_action_msg msg = {
            .dev = mouse_gesture_devs[i],
            .activate = ev->is_active,
        };
        if (k_msgq_put(&state_action_msgq, &msg, K_MSEC(10)) != 0) {
            LOG_WRN("State action queue full – state change dropped");
        }
    }

    /* Ensure work runs */
    k_work_submit(&gesture_exec_work);

    return ZMK_EV_EVENT_BUBBLE;
}

static const struct zmk_input_processor_driver_api input_processor_mouse_gesture_driver_api = {
    .handle_event = input_processor_mouse_gesture_handle_event,
};

#define BINDINGS_ARRAY(node_id) LISTIFY(DT_PROP_LEN(node_id, bindings), ZMK_KEYMAP_EXTRACT_BINDING, (, ), node_id)

#define DECLARE_GESTURE_CHILD(node_id) \
    static const struct zmk_behavior_binding gesture_pattern_bindings_##node_id[] = { BINDINGS_ARRAY(node_id) }; \
    static const uint8_t gesture_pattern_seq_##node_id[] = DT_PROP(node_id, pattern);

#define GESTURE_PATTERN_ENTRY(node_id)                                                    \
    {                                                                                    \
        .bindings_len = DT_PROP_LEN(node_id, bindings),                                   \
        .bindings = gesture_pattern_bindings_##node_id,                                   \
        .pattern_len = DT_PROP_LEN(node_id, pattern),                                     \
        .wait_ms = DT_PROP_OR(node_id, wait_ms, CONFIG_ZMK_MACRO_DEFAULT_WAIT_MS),        \
        .tap_ms = DT_PROP_OR(node_id, tap_ms, CONFIG_ZMK_MACRO_DEFAULT_TAP_MS),           \
        .pattern = gesture_pattern_seq_##node_id,                                         \
    },

#define MOUSE_GESTURE_INPUT_PROCESSOR_INST(n)                                                         \
    DT_FOREACH_CHILD(DT_DRV_INST(n), DECLARE_GESTURE_CHILD)                                           \
    static const struct gesture_pattern gesture_patterns_##n[] = {                                    \
        DT_FOREACH_CHILD(DT_DRV_INST(n), GESTURE_PATTERN_ENTRY)                                       \
    };                                                                                                \
    static struct input_processor_mouse_gesture_data                                                  \
        input_processor_mouse_gesture_data_##n = {};                                                  \
    static const struct input_processor_mouse_gesture_config                                          \
        input_processor_mouse_gesture_config_##n = {                                                  \
        .stroke_size = DT_INST_PROP_OR(n, stroke_size, 200),                                          \
        .movement_threshold = DT_INST_PROP_OR(n, movement_threshold, 0),                             \
        .gesture_cooldown_ms = DT_INST_PROP_OR(n, gesture_cooldown_ms, 500),                          \
        .enable_eager_mode = DT_INST_PROP_OR(n, enable_eager_mode, false),                            \
        .always_active = DT_INST_PROP_OR(n, always_active, false),                                    \
        .idle_timeout_ms = DT_INST_PROP_OR(n, idle_timeout_ms, 150),                                  \
        .event_code_x = (uint16_t)DT_INST_PROP_OR(n, event_code_x, INPUT_REL_X),                          \
        .event_code_y = (uint16_t)DT_INST_PROP_OR(n, event_code_y, INPUT_REL_Y),                          \
        .patterns = gesture_patterns_##n,                                                             \
        .pattern_count = ARRAY_SIZE(gesture_patterns_##n),                                            \
    };                                                                                                \
    DEVICE_DT_INST_DEFINE(n, input_processor_mouse_gesture_init, NULL,                                \
                          &input_processor_mouse_gesture_data_##n,                                    \
                          &input_processor_mouse_gesture_config_##n, POST_KERNEL,                     \
                          CONFIG_KERNEL_INIT_PRIORITY_DEFAULT,                                        \
                          &input_processor_mouse_gesture_driver_api);

DT_INST_FOREACH_STATUS_OKAY(MOUSE_GESTURE_INPUT_PROCESSOR_INST)

// Register event listener
ZMK_LISTENER(mouse_gesture_input_processor, mouse_gesture_state_listener);
ZMK_SUBSCRIPTION(mouse_gesture_input_processor, zmk_mouse_gesture_state_changed);

static const struct device *get_primary_mouse_gesture_dev(void) {
#define MOUSE_GESTURE_PRIMARY_DEV(n) DEVICE_DT_INST_GET(n),
    static const struct device *const devs[] = {DT_INST_FOREACH_STATUS_OKAY(MOUSE_GESTURE_PRIMARY_DEV)};
    if (ARRAY_SIZE(devs) == 0) {
        return NULL;
    }
    return devs[0];
}

static int fill_runtime_config_from_effective(const struct device *dev,
                                              struct zmk_mouse_gesture_runtime_config *out) {
    if (!dev || !out) {
        return -EINVAL;
    }

    memset(out, 0, sizeof(*out));

    out->stroke_size = effective_stroke_size(dev);
    out->idle_timeout_ms = effective_idle_timeout_ms(dev);
    out->gesture_cooldown_ms = effective_gesture_cooldown_ms(dev);
    out->movement_threshold = effective_movement_threshold(dev);
    out->enable_eager_mode = effective_enable_eager_mode(dev);
    out->always_active = effective_always_active(dev);

    size_t pattern_count = 0;
    const struct gesture_pattern *patterns = effective_patterns(dev, &pattern_count);
    out->gesture_count = MIN(pattern_count, ZMK_MOUSE_GESTURE_RUNTIME_MAX_GESTURES);

    for (size_t i = 0; i < out->gesture_count; i++) {
        struct zmk_mouse_gesture_runtime_gesture *gesture = &out->gestures[i];
        snprintf(gesture->name, sizeof(gesture->name), "gesture_%u", (unsigned int)(i + 1));
        gesture->pattern_len =
            MIN(patterns[i].pattern_len, ZMK_MOUSE_GESTURE_RUNTIME_MAX_DIRECTIONS);
        memcpy(gesture->pattern, patterns[i].pattern, gesture->pattern_len);
        gesture->bindings_len = MIN(patterns[i].bindings_len, ZMK_MOUSE_GESTURE_RUNTIME_MAX_BINDINGS);
        for (size_t j = 0; j < gesture->bindings_len; j++) {
            gesture->bindings[j].local_id =
                zmk_behavior_get_local_id(patterns[i].bindings[j].behavior_dev);
            gesture->bindings[j].param1 = patterns[i].bindings[j].param1;
            gesture->bindings[j].param2 = patterns[i].bindings[j].param2;
        }
    }

    return 0;
}

static int apply_runtime_config_locked(const struct device *dev,
                                       const struct zmk_mouse_gesture_runtime_config *config) {
    struct input_processor_mouse_gesture_data *data = dev->data;

    if (config->gesture_count > ZMK_MOUSE_GESTURE_RUNTIME_MAX_GESTURES) {
        return -EINVAL;
    }

    memset(data->runtime_patterns, 0, sizeof(data->runtime_patterns));
    memset(data->runtime_bindings, 0, sizeof(data->runtime_bindings));
    memset(data->runtime_sequences, 0, sizeof(data->runtime_sequences));

    for (size_t i = 0; i < config->gesture_count; i++) {
        const struct zmk_mouse_gesture_runtime_gesture *src = &config->gestures[i];
        if (src->pattern_len == 0 ||
            src->pattern_len > ZMK_MOUSE_GESTURE_RUNTIME_MAX_DIRECTIONS ||
            src->bindings_len == 0 ||
            src->bindings_len > ZMK_MOUSE_GESTURE_RUNTIME_MAX_BINDINGS) {
            return -EINVAL;
        }

        for (size_t j = 0; j < src->pattern_len; j++) {
            if (!direction_is_valid(src->pattern[j])) {
                return -EINVAL;
            }
            data->runtime_sequences[i][j] = src->pattern[j];
        }

        for (size_t j = 0; j < src->bindings_len; j++) {
            const char *behavior_name =
                zmk_behavior_find_behavior_name_from_local_id(src->bindings[j].local_id);
            if (!behavior_name) {
                return -EINVAL;
            }

            data->runtime_bindings[i][j] = (struct zmk_behavior_binding){
#if IS_ENABLED(CONFIG_ZMK_BEHAVIOR_LOCAL_IDS_IN_BINDINGS)
                .local_id = src->bindings[j].local_id,
#endif
                .behavior_dev = behavior_name,
                .param1 = src->bindings[j].param1,
                .param2 = src->bindings[j].param2,
            };
        }

        data->runtime_patterns[i] = (struct gesture_pattern){
            .bindings_len = src->bindings_len,
            .bindings = data->runtime_bindings[i],
            .pattern_len = src->pattern_len,
            .wait_ms = CONFIG_ZMK_MACRO_DEFAULT_WAIT_MS,
            .tap_ms = CONFIG_ZMK_MACRO_DEFAULT_TAP_MS,
            .pattern = data->runtime_sequences[i],
        };
    }

    data->runtime_pattern_count = config->gesture_count;
    data->runtime_stroke_size = config->stroke_size;
    data->runtime_idle_timeout_ms = config->idle_timeout_ms;
    data->runtime_gesture_cooldown_ms = config->gesture_cooldown_ms;
    data->runtime_movement_threshold = config->movement_threshold;
    data->runtime_enable_eager_mode = config->enable_eager_mode;
    data->runtime_always_active = config->always_active;
    data->runtime_config_loaded = true;
    data->is_active = effective_always_active(dev);
    rebuild_gesture_trie_locked(dev);

    return 0;
}

static void save_work_handler(struct k_work *work) {
    struct k_work_delayable *delayed = k_work_delayable_from_work(work);
    struct input_processor_mouse_gesture_data *data =
        CONTAINER_OF(delayed, struct input_processor_mouse_gesture_data, save_work);
    const struct device *dev = data->dev;
    struct zmk_mouse_gesture_runtime_config current = {0};
    struct persisted_config persisted = {
        .magic = MOUSE_GESTURE_SETTINGS_MAGIC,
        .version = MOUSE_GESTURE_SETTINGS_VERSION,
    };

    if (!dev || zmk_mouse_gesture_runtime_get(&current) < 0) {
        return;
    }

    persisted.stroke_size = current.stroke_size;
    persisted.idle_timeout_ms = current.idle_timeout_ms;
    persisted.gesture_cooldown_ms = current.gesture_cooldown_ms;
    persisted.movement_threshold = current.movement_threshold;
    persisted.enable_eager_mode = current.enable_eager_mode;
    persisted.always_active = current.always_active;
    persisted.gesture_count = current.gesture_count;

    for (size_t i = 0; i < current.gesture_count; i++) {
        struct persisted_gesture *dst = &persisted.gestures[i];
        const struct zmk_mouse_gesture_runtime_gesture *src = &current.gestures[i];
        strncpy(dst->name, src->name, sizeof(dst->name) - 1);
        dst->pattern_len = src->pattern_len;
        memcpy(dst->pattern, src->pattern, src->pattern_len);
        dst->bindings_len = src->bindings_len;
        for (size_t j = 0; j < src->bindings_len; j++) {
            dst->bindings[j].local_id = src->bindings[j].local_id;
            dst->bindings[j].param1 = src->bindings[j].param1;
            dst->bindings[j].param2 = src->bindings[j].param2;
        }
    }

    int rc = settings_save_one(MOUSE_GESTURE_SETTINGS_KEY, &persisted, sizeof(persisted));
    if (rc < 0) {
        LOG_WRN("Failed to save mouse gesture settings: %d", rc);
    }
}

int zmk_mouse_gesture_runtime_get(struct zmk_mouse_gesture_runtime_config *config) {
    const struct device *dev = get_primary_mouse_gesture_dev();
    if (!dev) {
        return -ENODEV;
    }

    struct input_processor_mouse_gesture_data *data = dev->data;
    int rc = k_mutex_lock(&data->lock, K_MSEC(100));
    if (rc < 0) {
        return rc;
    }

    rc = fill_runtime_config_from_effective(dev, config);
    k_mutex_unlock(&data->lock);
    return rc;
}

int zmk_mouse_gesture_runtime_set(const struct zmk_mouse_gesture_runtime_config *config) {
    const struct device *dev = get_primary_mouse_gesture_dev();
    if (!dev || !config) {
        return -EINVAL;
    }

    struct input_processor_mouse_gesture_data *data = dev->data;
    int rc = k_mutex_lock(&data->lock, K_MSEC(100));
    if (rc < 0) {
        return rc;
    }

    rc = apply_runtime_config_locked(dev, config);
    k_mutex_unlock(&data->lock);

    if (rc == 0) {
        k_work_reschedule(&data->save_work,
                          K_MSEC(CONFIG_ZMK_MOUSE_GESTURE_SETTINGS_SAVE_DEBOUNCE));
    }
    return rc;
}

int zmk_mouse_gesture_runtime_reset(void) {
    const struct device *dev = get_primary_mouse_gesture_dev();
    if (!dev) {
        return -ENODEV;
    }

    struct input_processor_mouse_gesture_data *data = dev->data;
    int rc = k_mutex_lock(&data->lock, K_MSEC(100));
    if (rc < 0) {
        return rc;
    }

    data->runtime_config_loaded = false;
    data->is_active = effective_always_active(dev);
    rebuild_gesture_trie_locked(dev);
    k_mutex_unlock(&data->lock);

    rc = settings_delete(MOUSE_GESTURE_SETTINGS_KEY);
    if (rc == -ENOENT) {
        return 0;
    }
    return rc;
}

static int mouse_gesture_settings_set(const char *name, size_t len, settings_read_cb read_cb,
                                      void *cb_arg) {
    const char *next;
    if (!settings_name_steq(name, "config", &next) || next) {
        return -ENOENT;
    }

    struct persisted_config persisted = {0};
    ssize_t rc = read_cb(cb_arg, &persisted, MIN(len, sizeof(persisted)));
    if (rc < 0) {
        return rc;
    }
    if (persisted.magic != MOUSE_GESTURE_SETTINGS_MAGIC ||
        persisted.version != MOUSE_GESTURE_SETTINGS_VERSION) {
        return -EINVAL;
    }

    struct zmk_mouse_gesture_runtime_config config = {
        .stroke_size = persisted.stroke_size,
        .idle_timeout_ms = persisted.idle_timeout_ms,
        .gesture_cooldown_ms = persisted.gesture_cooldown_ms,
        .movement_threshold = persisted.movement_threshold,
        .enable_eager_mode = persisted.enable_eager_mode,
        .always_active = persisted.always_active,
        .gesture_count = persisted.gesture_count,
    };

    for (size_t i = 0; i < config.gesture_count; i++) {
        struct zmk_mouse_gesture_runtime_gesture *dst = &config.gestures[i];
        const struct persisted_gesture *src = &persisted.gestures[i];
        strncpy(dst->name, src->name, sizeof(dst->name) - 1);
        dst->pattern_len = src->pattern_len;
        memcpy(dst->pattern, src->pattern, src->pattern_len);
        dst->bindings_len = src->bindings_len;
        for (size_t j = 0; j < dst->bindings_len; j++) {
            dst->bindings[j].local_id = src->bindings[j].local_id;
            dst->bindings[j].param1 = src->bindings[j].param1;
            dst->bindings[j].param2 = src->bindings[j].param2;
        }
    }

    const struct device *dev = get_primary_mouse_gesture_dev();
    if (!dev) {
        return -ENODEV;
    }

    struct input_processor_mouse_gesture_data *data = dev->data;
    rc = k_mutex_lock(&data->lock, K_MSEC(100));
    if (rc < 0) {
        return rc;
    }
    rc = apply_runtime_config_locked(dev, &config);
    k_mutex_unlock(&data->lock);
    return rc;
}

SETTINGS_STATIC_HANDLER_DEFINE(mouse_gesture, "mouse_gesture", NULL, mouse_gesture_settings_set,
                               NULL, NULL);

#endif
