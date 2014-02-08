#include "pebble.h"

#define TOP_MENU_NUM_SECTIONS 1
#define TOP_MENU_FIRST_SECTION_NUM_MENU_ITEMS 2
#define TOP_MENU_NUM_ICONS 2

#define DEVICES_MENU_NUM_SECTIONS 1
#define MAX_NUMBER_OF_DEVICES 50
#define MAX_DEVICE_NAME_LENGTH 96

#define ACTIONS_MENU_NUM_SECTIONS 1
#define MAX_NUMBER_OF_ACTIONS 50
#define MAX_ACTION_NAME_LENGTH 96

#define MAX_DIM 100
#define MIN_DIM 0
#define DEFAULT_DIM 50

#define STATUS_OFF 0
#define STATUS_ON 1
#define STATUS_NONE 10
#define STATUS_GETTING_STATE 11
#define STATUS_TOGGLING 12
#define STATUS_EXECUTING 13
#define STATUS_LOADING 14
#define STATUS_COULD_NOT_CONNECT 15
#define STATUS_LOADED 16

// Handy for using snprintf to display integers
//#define TEMP_STRING_LENGTH 15
//static char tempStr[TEMP_STRING_LENGTH];

static Window *top_window;
static MenuLayer *top_menu_layer;
static GBitmap *device_menu_item_icon;
static GBitmap *action_menu_item_icon;

static Window *devices_window;
static MenuLayer *devices_menu_layer;
static uint8_t deviceCount = 0;
static uint8_t gotDeviceCount = STATUS_LOADING;

static Window *dim_window;
static ActionBarLayer *dim_action_bar_layer;
static TextLayer *dim_header_text_layer;
static TextLayer *dim_body_text_layer;
static TextLayer *dim_label_text_layer;
static uint8_t dimLevel = DEFAULT_DIM;
static uint8_t selectedDeviceNumber = 0;
static char selectedDeviceName[MAX_DEVICE_NAME_LENGTH];
static GBitmap *action_icon_plus;
static GBitmap *action_icon_select;
static GBitmap *action_icon_minus;

static Window *actions_window;
static MenuLayer *actions_menu_layer;
static uint8_t actionCount = 0;
static uint8_t gotActionCount = STATUS_LOADING;

enum {
    INDIGO_REMOTE_KEY_GET_DEVICES_AND_ACTIONS = 1,
    INDIGO_REMOTE_KEY_DEVICE_COUNT_COMPLETE = 2,
    INDIGO_REMOTE_KEY_DEVICE_COUNT = 3,
    INDIGO_REMOTE_KEY_DEVICE = 4,
    INDIGO_REMOTE_KEY_DEVICE_NUMBER = 5,
    INDIGO_REMOTE_KEY_DEVICE_NAME = 6,
    INDIGO_REMOTE_KEY_DEVICE_ON = 7,
    INDIGO_REMOTE_KEY_DEVICE_TOGGLE_ON_OFF = 8,
    INDIGO_REMOTE_KEY_DEVICE_DIM = 9,
    INDIGO_REMOTE_KEY_DEVICE_DIM_LEVEL = 10,
    INDIGO_REMOTE_KEY_ACTION_COUNT_COMPLETE = 11,
    INDIGO_REMOTE_KEY_ACTION_COUNT = 12,
    INDIGO_REMOTE_KEY_ACTION = 13,
    INDIGO_REMOTE_KEY_ACTION_NUMBER = 14,
    INDIGO_REMOTE_KEY_ACTION_NAME = 15,
    INDIGO_REMOTE_KEY_ACTION_EXECUTE = 16
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
    Tuple *device_count_complete_tuple = dict_find(iter, INDIGO_REMOTE_KEY_DEVICE_COUNT_COMPLETE);
    Tuple *device_count_tuple = dict_find(iter, INDIGO_REMOTE_KEY_DEVICE_COUNT);
    Tuple *device_tuple = dict_find(iter, INDIGO_REMOTE_KEY_DEVICE);
    Tuple *action_count_complete_tuple = dict_find(iter, INDIGO_REMOTE_KEY_ACTION_COUNT_COMPLETE);
    Tuple *action_count_tuple = dict_find(iter, INDIGO_REMOTE_KEY_ACTION_COUNT);
    Tuple *action_tuple = dict_find(iter, INDIGO_REMOTE_KEY_ACTION);
    
    if (device_count_complete_tuple) {
        if (device_count_tuple->value->uint8 <= MAX_NUMBER_OF_DEVICES) {
            deviceCount = device_count_tuple->value->uint8;
        }
        else {
            deviceCount = MAX_NUMBER_OF_DEVICES;
        }
        
        for (int i = 0; i < deviceCount; i++) {
            strncpy(device_data_list[i].name, "Loading...", MAX_DEVICE_NAME_LENGTH);
            device_data_list[i].on = STATUS_GETTING_STATE;
        }

        gotDeviceCount = STATUS_LOADED;
        if (window_stack_get_top_window() == top_window) {
            layer_mark_dirty(menu_layer_get_layer(top_menu_layer));
        }
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
                
                if (window_stack_get_top_window() == devices_window) {
                    layer_mark_dirty(menu_layer_get_layer(devices_menu_layer));
                }
            }
        }
    }
    
    if (action_count_complete_tuple) {
        // Got action count
        if (action_count_tuple->value->uint8 <= MAX_NUMBER_OF_ACTIONS) {
            actionCount = action_count_tuple->value->uint8;
        }
        else {
            actionCount = MAX_NUMBER_OF_ACTIONS;
        }
        
        for (int i = 0; i < actionCount; i++) {
            strncpy(action_data_list[i].name, "Loading", MAX_ACTION_NAME_LENGTH);
            action_data_list[i].status = STATUS_NONE;
        }
        
        gotActionCount = STATUS_LOADED;
        if (window_stack_get_top_window() == top_window) {
            layer_mark_dirty(menu_layer_get_layer(top_menu_layer));
        }
    }
    
    if (action_tuple) {
        // Add the action info to our list
        Tuple *actionNumber = dict_find(iter, INDIGO_REMOTE_KEY_ACTION_NUMBER);
        Tuple *name = dict_find(iter, INDIGO_REMOTE_KEY_ACTION_NAME);
        APP_LOG(APP_LOG_LEVEL_DEBUG, "1");
        
        if (actionNumber) {
            APP_LOG(APP_LOG_LEVEL_DEBUG, "2");
            if (actionNumber->value->uint8 < MAX_NUMBER_OF_ACTIONS) {
                if (name) {
                    APP_LOG(APP_LOG_LEVEL_DEBUG, "3");
                    strncpy(action_data_list[actionNumber->value->uint8].name, name->value->cstring, MAX_ACTION_NAME_LENGTH);
                }
                APP_LOG(APP_LOG_LEVEL_DEBUG, "4");
                action_data_list[actionNumber->value->uint8].status = STATUS_NONE;
                
                if (window_stack_get_top_window() == actions_window) {
                    APP_LOG(APP_LOG_LEVEL_DEBUG, "5");
                    layer_mark_dirty(menu_layer_get_layer(actions_menu_layer));
                }
            }
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
    Tuplet device_toggle_on_off_tuple = TupletInteger(INDIGO_REMOTE_KEY_DEVICE_TOGGLE_ON_OFF, 1);
    Tuplet device_number_tuple = TupletInteger(INDIGO_REMOTE_KEY_DEVICE_NUMBER, deviceNumber);
    
    DictionaryIterator *iter;
    app_message_outbox_begin(&iter);
    
    if (iter == NULL) {
        return;
    }
    
    dict_write_tuplet(iter, &device_toggle_on_off_tuple);
    dict_write_tuplet(iter, &device_number_tuple);
    dict_write_end(iter);
    
    app_message_outbox_send();
}

// Request to execute the specified action
static void execute_msg(uint8_t actionNumber) {
    Tuplet action_execute_tuple = TupletInteger(INDIGO_REMOTE_KEY_ACTION_EXECUTE, 1);
    Tuplet action_number_tuple = TupletInteger(INDIGO_REMOTE_KEY_ACTION_NUMBER, actionNumber);
    
    DictionaryIterator *iter;
    app_message_outbox_begin(&iter);
    
    if (iter == NULL) {
        return;
    }
    
    dict_write_tuplet(iter, &action_execute_tuple);
    dict_write_tuplet(iter, &action_number_tuple);
    dict_write_end(iter);
    
    app_message_outbox_send();
}

// Request to execute the specified action
static void dim_msg(uint8_t deviceNumber) {
    Tuplet device_dim_tuple = TupletInteger(INDIGO_REMOTE_KEY_DEVICE_DIM, 1);
    Tuplet device_number_tuple = TupletInteger(INDIGO_REMOTE_KEY_DEVICE_NUMBER, deviceNumber);
    Tuplet device_dim_level_tuple = TupletInteger(INDIGO_REMOTE_KEY_DEVICE_DIM_LEVEL, dimLevel);
    
    DictionaryIterator *iter;
    app_message_outbox_begin(&iter);
    
    if (iter == NULL) {
        return;
    }
    
    dict_write_tuplet(iter, &device_dim_tuple);
    dict_write_tuplet(iter, &device_number_tuple);
    dict_write_tuplet(iter, &device_dim_level_tuple);
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
    if (device_data_list[cell_index->row].on != STATUS_TOGGLING) {
        toggle_msg(cell_index->row);
        device_data_list[cell_index->row].on = STATUS_TOGGLING;
        layer_mark_dirty(menu_layer_get_layer(devices_menu_layer));
    }
}

static void devices_menu_select_long_click_callback(MenuLayer *menu_layer, MenuIndex *cell_index, void *data) {
    // Go to the dim window
    selectedDeviceNumber = cell_index->row;
    strncpy(selectedDeviceName, device_data_list[selectedDeviceNumber].name, MAX_DEVICE_NAME_LENGTH);
    window_stack_push(dim_window, true /* Animated */);
}

// Here we capture when a user selects a menu item
static void actions_menu_select_callback(MenuLayer *menu_layer, MenuIndex *cell_index, void *data) {
    if (action_data_list[cell_index->row].status != STATUS_EXECUTING) {
        execute_msg(cell_index->row);
        action_data_list[cell_index->row].status = STATUS_EXECUTING;
        layer_mark_dirty(menu_layer_get_layer(actions_menu_layer));
    }
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
                    menu_cell_basic_draw(ctx, cell_layer, "Devices", (gotDeviceCount == STATUS_LOADING)? "Loading...":(gotDeviceCount == STATUS_LOADED)?"Control devices":"Could not connect", device_menu_item_icon);
                    break;
                    
                case 1:
                    // This is a basic menu item with a title and subtitle
                    menu_cell_basic_draw(ctx, cell_layer, "Actions", (gotActionCount == STATUS_LOADING)? "Loading...":(gotActionCount == STATUS_LOADED)?"Execute actions":"Could not connect", action_menu_item_icon);
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
        if (window_stack_get_top_window() == top_window) {
            layer_mark_dirty(menu_layer_get_layer(top_menu_layer));
        }
    }
    if (gotActionCount == STATUS_LOADING) {
        gotActionCount = STATUS_COULD_NOT_CONNECT;
        if (window_stack_get_top_window() == top_window) {
            layer_mark_dirty(menu_layer_get_layer(top_menu_layer));
        }
    }
}

// This initializes the menu upon window load
static void top_window_load(Window *window) {
    // Here we load the bitmap assets
    // resource_init_current_app must be called before all asset loading
    device_menu_item_icon = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_MENU_ICON_DEVICE_MENU_ITEM);
    action_menu_item_icon = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_MENU_ICON_ACTION_MENU_ITEM);

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
        .select_click = top_menu_select_callback
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
    gbitmap_destroy(device_menu_item_icon);
    gbitmap_destroy(action_menu_item_icon);
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
        .select_long_click = devices_menu_select_long_click_callback
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
        .select_click = actions_menu_select_callback
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

static void dim_update_text() {
    static char body_text[50];
    snprintf(body_text, sizeof(body_text), "%u Percent", dimLevel);
    text_layer_set_text(dim_body_text_layer, body_text);
}

static void dim_increment_click_handler(ClickRecognizerRef recognizer, void *context) {
    if (dimLevel >= MAX_DIM) {
        return;
    }
    
    dimLevel++;
    
    device_data_list[selectedDeviceNumber].on = STATUS_ON;
    
    dim_update_text();
}

static void dim_select_single_click_handler(ClickRecognizerRef recognizer, void *context) {
    dim_msg(selectedDeviceNumber);
}

static void dim_decrement_click_handler(ClickRecognizerRef recognizer, void *context) {
    if (dimLevel <= MIN_DIM) {
        return;
    }
    
    dimLevel--;
    
    if (dimLevel <= MIN_DIM) {
        device_data_list[selectedDeviceNumber].on = STATUS_OFF;
    }
    
    dim_update_text();
}

static void dim_click_config_provider(void *context) {
    const uint16_t repeat_interval_ms = 50;
    window_single_repeating_click_subscribe(BUTTON_ID_UP, repeat_interval_ms, (ClickHandler) dim_increment_click_handler);
    window_single_click_subscribe(BUTTON_ID_SELECT, dim_select_single_click_handler);
    window_single_repeating_click_subscribe(BUTTON_ID_DOWN, repeat_interval_ms, (ClickHandler) dim_decrement_click_handler);
}

// This initializes the menu upon window load
static void dim_window_load(Window *window) {
    action_icon_plus = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_ACTION_ICON_PLUS);
    action_icon_select = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_ACTION_ICON_SELECT);
    action_icon_minus = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_ACTION_ICON_MINUS);
    
    // Create the action bar layer
    dim_action_bar_layer = action_bar_layer_create();
    action_bar_layer_add_to_window(dim_action_bar_layer, window);
    
    // Bind the menu layer's click config provider to the window for interactivity
    action_bar_layer_set_click_config_provider(dim_action_bar_layer, dim_click_config_provider);
    
    action_bar_layer_set_icon(dim_action_bar_layer, BUTTON_ID_UP, action_icon_plus);
    action_bar_layer_set_icon(dim_action_bar_layer, BUTTON_ID_SELECT, action_icon_select);
    action_bar_layer_set_icon(dim_action_bar_layer, BUTTON_ID_DOWN, action_icon_minus);

    Layer *window_layer = window_get_root_layer(window);
    const int16_t width = layer_get_frame(window_layer).size.w - ACTION_BAR_WIDTH - 3;
    
    dim_header_text_layer = text_layer_create(GRect(4, 4, width, 60));
    text_layer_set_font(dim_header_text_layer, fonts_get_system_font(FONT_KEY_GOTHIC_24));
    text_layer_set_background_color(dim_header_text_layer, GColorClear);
    text_layer_set_text(dim_header_text_layer, "Set dim level to:");
    layer_add_child(window_layer, text_layer_get_layer(dim_header_text_layer));
    
    dim_body_text_layer = text_layer_create(GRect(4, 24 + 32, width, 60));
    text_layer_set_font(dim_body_text_layer, fonts_get_system_font(FONT_KEY_GOTHIC_28_BOLD));
    text_layer_set_background_color(dim_body_text_layer, GColorClear);
    layer_add_child(window_layer, text_layer_get_layer(dim_body_text_layer));
    
    dim_label_text_layer = text_layer_create(GRect(4, 24 + 32 + 28 + 28, width, 60));
    text_layer_set_font(dim_label_text_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18));
    text_layer_set_background_color(dim_label_text_layer, GColorClear);
    text_layer_set_text(dim_label_text_layer, selectedDeviceName);
    layer_add_child(window_layer, text_layer_get_layer(dim_label_text_layer));
    
    dim_update_text();
}

static void dim_window_unload(Window *window) {
    text_layer_destroy(dim_header_text_layer);
    text_layer_destroy(dim_body_text_layer);
    text_layer_destroy(dim_label_text_layer);
    action_bar_layer_destroy(dim_action_bar_layer);
    gbitmap_destroy(action_icon_plus);
    gbitmap_destroy(action_icon_select);
    gbitmap_destroy(action_icon_minus);
}

static void init(void) {
    top_window = window_create();
    devices_window = window_create();
    actions_window = window_create();
    dim_window = window_create();
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
    window_set_window_handlers(dim_window, (WindowHandlers) {
        .load = dim_window_load,
        .unload = dim_window_unload,
    });
    
    window_stack_push(top_window, true /* Animated */);
}

static void deinit(void) {
    window_destroy(dim_window);
    window_destroy(actions_window);
    window_destroy(devices_window);
    window_destroy(top_window);
}

int main(void) {
    init();
    app_event_loop();
    deinit();
}