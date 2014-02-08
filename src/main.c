#include "pebble.h"

#define TOP_MENU_NUM_SECTIONS 1
#define TOP_MENU_FIRST_SECTION_NUM_MENU_ITEMS 2
#define TOP_MENU_NUM_ICONS 2

#define DEVICES_MENU_NUM_SECTIONS 1
#define MAX_NUMBER_OF_DEVICES 50
#define MAX_DEVICE_NAME_LENGTH 16

#define ACTIONS_MENU_NUM_SECTIONS 1
#define MAX_NUMBER_OF_ACTIONS 50
#define MAX_ACTION_NAME_LENGTH 16

#define STATUS_OFF 0
#define STATUS_ON 1
#define STATUS_NONE 10
#define STATUS_GETTING_STATE 11
#define STATUS_TOGGLING 12
#define STATUS_EXECUTING 13
#define STATUS_LOADING 14
#define STATUS_COULD_NOT_CONNECT 15
#define STATUS_LOADED 16

#define TEMP_STRING_LENGTH 15

static Window *top_window;
static MenuLayer *top_menu_layer;
static GBitmap *top_menu_icons[TOP_MENU_NUM_ICONS];

static Window *devices_window;
static MenuLayer *devices_menu_layer;
static uint8_t deviceCount = 0;
uint8_t gotDeviceCount = STATUS_LOADING;

static Window *actions_window;
static MenuLayer *actions_menu_layer;
static uint8_t actionCount = 0;
uint8_t gotActionCount = STATUS_LOADING;

// Handy for using snprintf to display integers
static char tempStr[TEMP_STRING_LENGTH];

enum {
    INDIGO_REMOTE_KEY_GET_DEVICES_AND_ACTIONS = 1,
    INDIGO_REMOTE_KEY_DEVICE_COUNT = 2,
    INDIGO_REMOTE_KEY_DEVICE = 3,
    INDIGO_REMOTE_KEY_DEVICE_NUMBER = 4,
    INDIGO_REMOTE_KEY_DEVICE_NAME = 5,
    INDIGO_REMOTE_KEY_DEVICE_ON = 6,
    INDIGO_REMOTE_KEY_DEVICE_TOGGLE_ON_OFF = 7,
    INDIGO_REMOTE_KEY_ACTION_COUNT = 8,
    INDIGO_REMOTE_KEY_ACTION = 9,
    INDIGO_REMOTE_KEY_ACTION_NUMBER = 10,
    INDIGO_REMOTE_KEY_ACTION_NAME = 11,
    INDIGO_REMOTE_KEY_ACTION_EXECUTE = 12
};

typedef struct {
    char name[MAX_DEVICE_NAME_LENGTH];
    uint8_t on;
} DeviceData;

static DeviceData device_data_list[MAX_NUMBER_OF_DEVICES];

typedef struct {
    char name[MAX_ACTION_NAME_LENGTH];
    uint8_t status;
} ActionData;

static ActionData action_data_list[MAX_NUMBER_OF_ACTIONS];


/******* MESSAGE PASSING WITH PHONE BASED PEBBLE APP *******/

static void in_received_handler(DictionaryIterator *iter, void *context) {
    Tuple *device_count_tuple = dict_find(iter, INDIGO_REMOTE_KEY_DEVICE_COUNT);
    Tuple *device_tuple = dict_find(iter, INDIGO_REMOTE_KEY_DEVICE);
    Tuple *action_count_tuple = dict_find(iter, INDIGO_REMOTE_KEY_ACTION_COUNT);
    Tuple *action_tuple = dict_find(iter, INDIGO_REMOTE_KEY_ACTION);
    
    if (device_count_tuple) {
        if (device_count_tuple->value->uint8 <= MAX_NUMBER_OF_DEVICES) {
            deviceCount = device_count_tuple->value->uint8;
        }
        else {
            deviceCount = MAX_NUMBER_OF_DEVICES;
        }
        
        for (int i = 0; i < deviceCount; i++) {
            snprintf(tempStr, TEMP_STRING_LENGTH, "Device %d", i);
            strncpy(device_data_list[i].name, tempStr, MAX_DEVICE_NAME_LENGTH);
            device_data_list[i].on = STATUS_GETTING_STATE;
        }

        gotDeviceCount = STATUS_LOADED;
        layer_mark_dirty(menu_layer_get_layer(top_menu_layer));
    }
    
    if (device_tuple) {
        // Add the device info to our list
        Tuple *deviceNumber = dict_find(iter, INDIGO_REMOTE_KEY_DEVICE_NUMBER);
        Tuple *name = dict_find(iter, INDIGO_REMOTE_KEY_DEVICE_NAME);
        Tuple *on = dict_find(iter, INDIGO_REMOTE_KEY_DEVICE_ON);
        
        if (deviceNumber) {
            if (deviceNumber->value->uint8 < MAX_NUMBER_OF_DEVICES) {
                if (name) {
                    strncpy(device_data_list[deviceNumber->value->uint8].name, name->value->cstring, MAX_DEVICE_NAME_LENGTH);
                }
                if (on) {
                    device_data_list[deviceNumber->value->uint8].on = on->value->uint8;
                }
            }
        }
        
        if (window_stack_get_top_window() == devices_window) {
            layer_mark_dirty(menu_layer_get_layer(devices_menu_layer));
        }
    }
    
    if (action_count_tuple) {
        // Got action count
        if (action_count_tuple->value->uint8 <= MAX_NUMBER_OF_ACTIONS) {
            actionCount = action_count_tuple->value->uint8;
        }
        else {
            actionCount = MAX_NUMBER_OF_ACTIONS;
        }
        
        for (int i = 0; i < actionCount; i++) {
            snprintf(tempStr, TEMP_STRING_LENGTH, "Action %d", i);
            strncpy(action_data_list[i].name, tempStr, MAX_ACTION_NAME_LENGTH);
            action_data_list[i].status = STATUS_NONE;
        }
        
        gotActionCount = STATUS_LOADED;
        layer_mark_dirty(menu_layer_get_layer(top_menu_layer));
    }
    
    if (action_tuple) {
        // Add the action info to our list
        Tuple *actionNumber = dict_find(iter, INDIGO_REMOTE_KEY_ACTION_NUMBER);
        Tuple *name = dict_find(iter, INDIGO_REMOTE_KEY_ACTION_NAME);
        
        if (actionNumber) {
            if (actionNumber->value->uint8 < MAX_NUMBER_OF_ACTIONS) {
                if (name) {
                    strncpy(action_data_list[actionNumber->value->uint8].name, name->value->cstring, MAX_ACTION_NAME_LENGTH);
                }
                action_data_list[actionNumber->value->uint8].status = STATUS_NONE;
            }
        }
        
        if (window_stack_get_top_window() == actions_window) {
            layer_mark_dirty(menu_layer_get_layer(actions_menu_layer));
        }
    }
}

static void in_dropped_handler(AppMessageResult reason, void *context) {
    APP_LOG(APP_LOG_LEVEL_DEBUG, "App Message Dropped!");
}

static void out_failed_handler(DictionaryIterator *failed, AppMessageResult reason, void *context) {
    APP_LOG(APP_LOG_LEVEL_DEBUG, "App Message Failed to Send!");
}

static void app_message_init(void) {
    // Register message handlers
    app_message_register_inbox_received(in_received_handler);
    app_message_register_inbox_dropped(in_dropped_handler);
    app_message_register_outbox_failed(out_failed_handler);
    // Init buffers
    app_message_open(app_message_inbox_size_maximum(), app_message_outbox_size_maximum());
}

// Request information about the devices and actions known to the Indigo Server
static void devices_and_actions_msg(void) {
    Tuplet get_devices_and_actions_tuple = TupletInteger(INDIGO_REMOTE_KEY_GET_DEVICES_AND_ACTIONS, 1);
    
    DictionaryIterator *iter;
    app_message_outbox_begin(&iter);
    
    if (iter == NULL) {
        return;
    }
    
    dict_write_tuplet(iter, &get_devices_and_actions_tuple);
    dict_write_end(iter);
    
    app_message_outbox_send();
}

// Request to toggle on/off the specified device
static void toggle_msg(uint8_t deviceNumber) {
    Tuplet device_toggle_on_off_tuple = TupletInteger(INDIGO_REMOTE_KEY_DEVICE_TOGGLE_ON_OFF, deviceNumber);
    
    DictionaryIterator *iter;
    app_message_outbox_begin(&iter);
    
    if (iter == NULL) {
        return;
    }
    
    dict_write_tuplet(iter, &device_toggle_on_off_tuple);
    dict_write_end(iter);
    
    app_message_outbox_send();
}

// Request to execute the specified action
static void execute_msg(uint8_t actionNumber) {
    Tuplet action_execute_tuple = TupletInteger(INDIGO_REMOTE_KEY_ACTION_EXECUTE, actionNumber);
    
    DictionaryIterator *iter;
    app_message_outbox_begin(&iter);
    
    if (iter == NULL) {
        return;
    }
    
    dict_write_tuplet(iter, &action_execute_tuple);
    dict_write_end(iter);
    
    app_message_outbox_send();
}


/******* WATCHAPP UI *******/

// A callback is used to specify the amount of sections of menu items
// With this, you can dynamically add and remove sections
static uint16_t top_menu_get_num_sections_callback(MenuLayer *menu_layer, void *data) {
    return TOP_MENU_NUM_SECTIONS;
}

// A callback is used to specify the amount of sections of menu items
// With this, you can dynamically add and remove sections
static uint16_t devices_menu_get_num_sections_callback(MenuLayer *menu_layer, void *data) {
    return DEVICES_MENU_NUM_SECTIONS;
}

// A callback is used to specify the amount of sections of menu items
// With this, you can dynamically add and remove sections
static uint16_t actions_menu_get_num_sections_callback(MenuLayer *menu_layer, void *data) {
    return ACTIONS_MENU_NUM_SECTIONS;
}

// Each section has a number of items;  we use a callback to specify this
// You can also dynamically add and remove items using this
static uint16_t top_menu_get_num_rows_callback(MenuLayer *menu_layer, uint16_t section_index, void *data) {
    switch (section_index) {
        case 0:
          return TOP_MENU_FIRST_SECTION_NUM_MENU_ITEMS;
        default:
          return 0;
    }
}

// Each section has a number of items;  we use a callback to specify this
// You can also dynamically add and remove items using this
static uint16_t devices_menu_get_num_rows_callback(MenuLayer *menu_layer, uint16_t section_index, void *data) {
    switch (section_index) {
        case 0:
            return deviceCount;
        default:
            return 0;
    }
}

// Each section has a number of items;  we use a callback to specify this
// You can also dynamically add and remove items using this
static uint16_t actions_menu_get_num_rows_callback(MenuLayer *menu_layer, uint16_t section_index, void *data) {
    switch (section_index) {
        case 0:
            return actionCount;
        default:
            return 0;
    }
}

// A callback is used to specify the height of the header
static int16_t top_menu_get_header_height_callback(MenuLayer *menu_layer, uint16_t section_index, void *data) {
    return 0;
}

// A callback is used to specify the height of the header
static int16_t devices_menu_get_header_height_callback(MenuLayer *menu_layer, uint16_t section_index, void *data) {
    // This is a define provided in pebble.h that you may use for the default heigh
    return MENU_CELL_BASIC_HEADER_HEIGHT * 2;
}

// A callback is used to specify the height of the header
static int16_t actions_menu_get_header_height_callback(MenuLayer *menu_layer, uint16_t section_index, void *data) {
    // This is a define provided in pebble.h that you may use for the default height
    return MENU_CELL_BASIC_HEADER_HEIGHT;
}

// Here we capture when a user selects a menu item
static void top_menu_select_callback(MenuLayer *menu_layer, MenuIndex *cell_index, void *data) {
    // Use the row to specify which item will receive the select action
    switch (cell_index->row) {
        case 0:
            if (gotDeviceCount == STATUS_LOADED) {
                // Go to the devices window
                window_stack_push(devices_window, true /* Animated */);
            }
            break;
        case 1:
            if (gotActionCount == STATUS_LOADED) {
                // Go to the actions window
                window_stack_push(actions_window, true /* Animated */);
            }
            break;
    }
}

// Here we capture when a user selects a menu item
static void devices_menu_select_callback(MenuLayer *menu_layer, MenuIndex *cell_index, void *data) {
    toggle_msg(cell_index->row);
    device_data_list[cell_index->row].on = STATUS_TOGGLING;
    layer_mark_dirty(menu_layer_get_layer(devices_menu_layer));
}

// Here we capture when a user selects a menu item
static void actions_menu_select_callback(MenuLayer *menu_layer, MenuIndex *cell_index, void *data) {
    execute_msg(cell_index->row);
    action_data_list[cell_index->row].status = STATUS_EXECUTING;
    layer_mark_dirty(menu_layer_get_layer(actions_menu_layer));
}

// Here we draw what header is
static void top_menu_draw_header_callback(GContext* ctx, const Layer *cell_layer, uint16_t section_index, void *data) {
    // Nothing to do - we're not using section headers
}

// Here we draw what header is
static void devices_menu_draw_header_callback(GContext* ctx, const Layer *cell_layer, uint16_t section_index, void *data) {
    // Determine which section we're working with
    switch (section_index) {
        case 0:
            // Draw title text in the section header
            menu_cell_basic_header_draw(ctx, cell_layer, "Click to toggle on/off\nClick and hold to dim");
            break;
    }
}

// Here we draw what header is
static void actions_menu_draw_header_callback(GContext* ctx, const Layer *cell_layer, uint16_t section_index, void *data) {
    // Determine which section we're working with
    switch (section_index) {
        case 0:
            // Draw title text in the section header
            menu_cell_basic_header_draw(ctx, cell_layer, "Click to execute");
            break;
    }
}

// This is the menu item draw callback where you specify what each item should look like
static void top_menu_draw_row_callback(GContext* ctx, const Layer *cell_layer, MenuIndex *cell_index, void *data) {
    // Determine which section we're going to draw in
    switch (cell_index->section) {
        case 0:
            // Use the row to specify which item we'll draw
            switch (cell_index->row) {
                case 0:
                    // This is a basic menu item with a title and subtitle
                    menu_cell_basic_draw(ctx, cell_layer, "Devices", (gotDeviceCount == STATUS_LOADING)? "Loading...":(gotDeviceCount == STATUS_LOADED)?"Control devices":"Could not connect", top_menu_icons[0]);
                    break;
                    
                case 1:
                    // This is a basic menu item with a title and subtitle
                    menu_cell_basic_draw(ctx, cell_layer, "Actions", (gotActionCount == STATUS_LOADING)? "Loading...":(gotActionCount == STATUS_LOADED)?"Execute actions":"Could not connect", top_menu_icons[1]);
                    break;
            }
            break;
    }
}

// This is the menu item draw callback where you specify what each item should look like
static void devices_menu_draw_row_callback(GContext* ctx, const Layer *cell_layer, MenuIndex *cell_index, void *data) {
    // Determine which section we're going to draw in
    switch (cell_index->section) {
        case 0:
            if (cell_index->row < deviceCount) {
                menu_cell_basic_draw(ctx, cell_layer, device_data_list[cell_index->row].name,
                    (device_data_list[cell_index->row].on == STATUS_GETTING_STATE)? "Getting current state...":
                    (device_data_list[cell_index->row].on == STATUS_TOGGLING)? "Toggling...":
                    (device_data_list[cell_index->row].on)? "On" : "Off", NULL);
            }
            break;
    }
}

// This is the menu item draw callback where you specify what each item should look like
static void actions_menu_draw_row_callback(GContext* ctx, const Layer *cell_layer, MenuIndex *cell_index, void *data) {
    // Determine which section we're going to draw in
    switch (cell_index->section) {
        case 0:
            if (cell_index->row < deviceCount) {
                menu_cell_basic_draw(ctx, cell_layer, action_data_list[cell_index->row].name,
                                     (action_data_list[cell_index->row].status == STATUS_EXECUTING)? "Executing...":"", NULL);
            }
            break;
    }
}

static void loading_timer_callback(void *data) {
    devices_and_actions_msg();
}

static void loading_timeout_callback(void *data) {
    if (gotDeviceCount == STATUS_LOADING) {
        gotDeviceCount = STATUS_COULD_NOT_CONNECT;
        layer_mark_dirty(menu_layer_get_layer(top_menu_layer));
    }
    if (gotActionCount == STATUS_LOADING) {
        gotActionCount = STATUS_COULD_NOT_CONNECT;
        layer_mark_dirty(menu_layer_get_layer(top_menu_layer));
    }
}

// This initializes the menu upon window load
static void top_window_load(Window *window) {
    // Here we load the bitmap assets
    // resource_init_current_app must be called before all asset loading
    int num_menu_icons = 0;
    top_menu_icons[num_menu_icons++] = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_MENU_ICON_BIG_WATCH);
    top_menu_icons[num_menu_icons++] = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_MENU_ICON_SECTOR_WATCH);

    // Now we prepare to initialize the menu layer
    // We need the bounds to specify the menu layer's viewport size
    // In this case, it'll be the same as the window's
    Layer *window_layer = window_get_root_layer(window);
    GRect bounds = layer_get_frame(window_layer);

    // Create the menu layer
    top_menu_layer = menu_layer_create(bounds);

    // Set all the callbacks for the menu layer
    menu_layer_set_callbacks(top_menu_layer, NULL, (MenuLayerCallbacks){
        .get_num_sections = top_menu_get_num_sections_callback,
        .get_num_rows = top_menu_get_num_rows_callback,
        .get_header_height = top_menu_get_header_height_callback,
        .draw_header = top_menu_draw_header_callback,
        .draw_row = top_menu_draw_row_callback,
        .select_click = top_menu_select_callback,
    });

    // Bind the menu layer's click config provider to the window for interactivity
    menu_layer_set_click_config_onto_window(top_menu_layer, window);

    // Add it to the window for display
    layer_add_child(window_layer, menu_layer_get_layer(top_menu_layer));
    
    // Fire off getting the devices info
    app_timer_register(250, loading_timer_callback, NULL);
    
    // Fire off a timeout handler
    app_timer_register(10000, loading_timeout_callback, NULL);

}

static void top_window_unload(Window *window) {
    // Destroy the menu layer
    menu_layer_destroy(top_menu_layer);

    // Cleanup the menu icons
    for (int i = 0; i < TOP_MENU_NUM_ICONS; i++) {
        gbitmap_destroy(top_menu_icons[i]);
    }
}

// This initializes the menu upon window load
static void devices_window_load(Window *window) {
    // Now we prepare to initialize the menu layer
    // We need the bounds to specify the menu layer's viewport size
    // In this case, it'll be the same as the window's
    Layer *window_layer = window_get_root_layer(window);
    GRect bounds = layer_get_frame(window_layer);

    // Create the menu layer
    devices_menu_layer = menu_layer_create(bounds);

    // Set all the callbacks for the menu layer
    menu_layer_set_callbacks(devices_menu_layer, NULL, (MenuLayerCallbacks){
        .get_num_sections = devices_menu_get_num_sections_callback,
        .get_num_rows = devices_menu_get_num_rows_callback,
        .get_header_height = devices_menu_get_header_height_callback,
        .draw_header = devices_menu_draw_header_callback,
        .draw_row = devices_menu_draw_row_callback,
        .select_click = devices_menu_select_callback,
    });

    // Bind the menu layer's click config provider to the window for interactivity
    menu_layer_set_click_config_onto_window(devices_menu_layer, window);
    
    // Add it to the window for display
    layer_add_child(window_layer, menu_layer_get_layer(devices_menu_layer));
}

static void devices_window_unload(Window *window) {
    // Destroy the menu layer
    menu_layer_destroy(devices_menu_layer);
}

// This initializes the menu upon window load
static void actions_window_load(Window *window) {
    // Now we prepare to initialize the menu layer
    // We need the bounds to specify the menu layer's viewport size
    // In this case, it'll be the same as the window's
    Layer *window_layer = window_get_root_layer(window);
    GRect bounds = layer_get_frame(window_layer);
    
    // Create the menu layer
    actions_menu_layer = menu_layer_create(bounds);
    
    // Set all the callbacks for the menu layer
    menu_layer_set_callbacks(actions_menu_layer, NULL, (MenuLayerCallbacks){
        .get_num_sections = actions_menu_get_num_sections_callback,
        .get_num_rows = actions_menu_get_num_rows_callback,
        .get_header_height = actions_menu_get_header_height_callback,
        .draw_header = actions_menu_draw_header_callback,
        .draw_row = actions_menu_draw_row_callback,
        .select_click = actions_menu_select_callback,
    });
    
    // Bind the menu layer's click config provider to the window for interactivity
    menu_layer_set_click_config_onto_window(actions_menu_layer, window);
    
    // Add it to the window for display
    layer_add_child(window_layer, menu_layer_get_layer(actions_menu_layer));
}

static void actions_window_unload(Window *window) {
    // Destroy the menu layer
    menu_layer_destroy(actions_menu_layer);
}

int main(void) {
    top_window = window_create();
    devices_window = window_create();
    actions_window = window_create();
    app_message_init();
    
    window_set_window_handlers(top_window, (WindowHandlers) {
        .load = top_window_load,
        .unload = top_window_unload,
    });
    window_set_window_handlers(devices_window, (WindowHandlers) {
        .load = devices_window_load,
        .unload = devices_window_unload,
    });
    window_set_window_handlers(actions_window, (WindowHandlers) {
        .load = actions_window_load,
        .unload = actions_window_unload,
    });

    window_stack_push(top_window, true /* Animated */);
    
    app_event_loop();

    window_destroy(actions_window);
    window_destroy(devices_window);
    window_destroy(top_window);
}