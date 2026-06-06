#include <pb_decode.h>
#include <pb_encode.h>
#include <string.h>
#include <zephyr/logging/log.h>
#include <zmk/mouse_gesture/runtime.h>
#include <zmk/mouse_gesture/mouse_gesture.pb.h>
#include <zmk/studio/custom.h>

LOG_MODULE_DECLARE(zmk, CONFIG_ZMK_LOG_LEVEL);

static struct zmk_rpc_custom_subsystem_meta mouse_gesture_meta = {
    ZMK_RPC_CUSTOM_SUBSYSTEM_UI_URLS("https://y-naoya17.github.io/zmk-mouse-gesture-studio/"),
    .security = ZMK_STUDIO_RPC_HANDLER_UNSECURED,
};

ZMK_RPC_CUSTOM_SUBSYSTEM(zmk_mouse_gesture, &mouse_gesture_meta,
                         mouse_gesture_rpc_handle_request);

ZMK_RPC_CUSTOM_SUBSYSTEM_RESPONSE_BUFFER(zmk_mouse_gesture, zmk_mouse_gesture_Response);

static void fill_proto_binding(const struct zmk_mouse_gesture_runtime_binding *src,
                               zmk_mouse_gesture_Binding *dst) {
    dst->local_id = src->local_id;
    dst->param1 = src->param1;
    dst->param2 = src->param2;
}

static void fill_runtime_binding(const zmk_mouse_gesture_Binding *src,
                                 struct zmk_mouse_gesture_runtime_binding *dst) {
    dst->local_id = src->local_id;
    dst->param1 = src->param1;
    dst->param2 = src->param2;
}

static int fill_proto_config(const struct zmk_mouse_gesture_runtime_config *src,
                             zmk_mouse_gesture_Config *dst) {
    memset(dst, 0, sizeof(*dst));
    dst->stroke_size = src->stroke_size;
    dst->idle_timeout_ms = src->idle_timeout_ms;
    dst->gesture_cooldown_ms = src->gesture_cooldown_ms;
    dst->movement_threshold = src->movement_threshold;
    dst->eager_mode = src->enable_eager_mode;
    dst->always_active = src->always_active;
    dst->gestures_count = src->gesture_count;

    for (size_t i = 0; i < src->gesture_count; i++) {
        const struct zmk_mouse_gesture_runtime_gesture *gesture = &src->gestures[i];
        zmk_mouse_gesture_Gesture *proto_gesture = &dst->gestures[i];
        strncpy(proto_gesture->name, gesture->name, sizeof(proto_gesture->name) - 1);
        proto_gesture->pattern_count = gesture->pattern_len;
        for (size_t j = 0; j < gesture->pattern_len; j++) {
            proto_gesture->pattern[j] = (zmk_mouse_gesture_Direction)gesture->pattern[j];
        }
        proto_gesture->bindings_count = gesture->bindings_len;
        for (size_t j = 0; j < gesture->bindings_len; j++) {
            fill_proto_binding(&gesture->bindings[j], &proto_gesture->bindings[j]);
        }
    }

    dst->activation_keys_count = src->activation_key_count;
    for (size_t i = 0; i < src->activation_key_count; i++) {
        const struct zmk_mouse_gesture_runtime_activation_key *activation =
            &src->activation_keys[i];
        zmk_mouse_gesture_ActivationKey *proto_activation = &dst->activation_keys[i];
        strncpy(proto_activation->name, activation->name, sizeof(proto_activation->name) - 1);
        proto_activation->position = activation->position;
        proto_activation->layer = activation->layer;
        proto_activation->tapping_term_ms = activation->tapping_term_ms;
        fill_proto_binding(&activation->tap, &proto_activation->tap);
        fill_proto_binding(&activation->up, &proto_activation->up);
        fill_proto_binding(&activation->down, &proto_activation->down);
        fill_proto_binding(&activation->left, &proto_activation->left);
        fill_proto_binding(&activation->right, &proto_activation->right);
    }

    return 0;
}

static int fill_runtime_config(const zmk_mouse_gesture_Config *src,
                               struct zmk_mouse_gesture_runtime_config *dst) {
    memset(dst, 0, sizeof(*dst));
    dst->stroke_size = src->stroke_size;
    dst->idle_timeout_ms = src->idle_timeout_ms;
    dst->gesture_cooldown_ms = src->gesture_cooldown_ms;
    dst->movement_threshold = src->movement_threshold;
    dst->enable_eager_mode = src->eager_mode;
    dst->always_active = src->always_active;
    dst->gesture_count = src->gestures_count;

    for (size_t i = 0; i < src->gestures_count; i++) {
        const zmk_mouse_gesture_Gesture *proto_gesture = &src->gestures[i];
        struct zmk_mouse_gesture_runtime_gesture *gesture = &dst->gestures[i];
        strncpy(gesture->name, proto_gesture->name, sizeof(gesture->name) - 1);
        gesture->pattern_len = proto_gesture->pattern_count;
        for (size_t j = 0; j < proto_gesture->pattern_count; j++) {
            switch (proto_gesture->pattern[j]) {
            case zmk_mouse_gesture_Direction_DIRECTION_UP:
            case zmk_mouse_gesture_Direction_DIRECTION_DOWN:
            case zmk_mouse_gesture_Direction_DIRECTION_LEFT:
            case zmk_mouse_gesture_Direction_DIRECTION_RIGHT:
                gesture->pattern[j] = (uint8_t)proto_gesture->pattern[j];
                break;
            default:
                return -EINVAL;
            }
        }
        gesture->bindings_len = proto_gesture->bindings_count;
        for (size_t j = 0; j < proto_gesture->bindings_count; j++) {
            fill_runtime_binding(&proto_gesture->bindings[j], &gesture->bindings[j]);
        }
    }

    dst->activation_key_count = src->activation_keys_count;
    for (size_t i = 0; i < src->activation_keys_count; i++) {
        const zmk_mouse_gesture_ActivationKey *proto_activation = &src->activation_keys[i];
        struct zmk_mouse_gesture_runtime_activation_key *activation = &dst->activation_keys[i];
        strncpy(activation->name, proto_activation->name, sizeof(activation->name) - 1);
        activation->position = proto_activation->position;
        activation->layer = proto_activation->layer;
        activation->tapping_term_ms = proto_activation->tapping_term_ms;
        fill_runtime_binding(&proto_activation->tap, &activation->tap);
        fill_runtime_binding(&proto_activation->up, &activation->up);
        fill_runtime_binding(&proto_activation->down, &activation->down);
        fill_runtime_binding(&proto_activation->left, &activation->left);
        fill_runtime_binding(&proto_activation->right, &activation->right);
    }

    return 0;
}

static void set_error(zmk_mouse_gesture_Response *resp, const char *message) {
    resp->which_response_type = zmk_mouse_gesture_Response_error_tag;
    strncpy(resp->response_type.error.message, message,
            sizeof(resp->response_type.error.message) - 1);
}

static bool mouse_gesture_rpc_handle_request(const zmk_custom_CallRequest *raw_request,
                                             pb_callback_t *encode_response) {
    zmk_mouse_gesture_Response *resp =
        ZMK_RPC_CUSTOM_SUBSYSTEM_RESPONSE_BUFFER_ALLOCATE(zmk_mouse_gesture, encode_response);

    zmk_mouse_gesture_Request req = zmk_mouse_gesture_Request_init_zero;
    pb_istream_t req_stream =
        pb_istream_from_buffer(raw_request->payload.bytes, raw_request->payload.size);
    if (!pb_decode(&req_stream, zmk_mouse_gesture_Request_fields, &req)) {
        set_error(resp, "Failed to decode request");
        return true;
    }

    int rc = 0;
    struct zmk_mouse_gesture_runtime_config config = {0};

    switch (req.which_request_type) {
    case zmk_mouse_gesture_Request_list_tag:
        rc = zmk_mouse_gesture_runtime_get(&config);
        if (rc < 0) {
            set_error(resp, "Failed to list gestures");
            return true;
        }
        resp->which_response_type = zmk_mouse_gesture_Response_list_tag;
        fill_proto_config(&config, &resp->response_type.list.config);
        return true;

    case zmk_mouse_gesture_Request_save_tag:
        rc = fill_runtime_config(&req.request_type.save.config, &config);
        if (rc == 0) {
            rc = zmk_mouse_gesture_runtime_set(&config);
        }
        if (rc < 0) {
            set_error(resp, "Failed to save gestures");
            return true;
        }
        resp->which_response_type = zmk_mouse_gesture_Response_save_tag;
        return true;

    case zmk_mouse_gesture_Request_reset_tag:
        rc = zmk_mouse_gesture_runtime_reset();
        if (rc == 0) {
            rc = zmk_mouse_gesture_runtime_get(&config);
        }
        if (rc < 0) {
            set_error(resp, "Failed to reset gestures");
            return true;
        }
        resp->which_response_type = zmk_mouse_gesture_Response_reset_tag;
        fill_proto_config(&config, &resp->response_type.reset.config);
        return true;

    default:
        set_error(resp, "Unsupported request");
        return true;
    }
}
