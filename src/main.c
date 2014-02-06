#include "pebble.h"

#define TOP_MENU_NUM_SECTIONS 1
#define TOP_MENU_FIRST_SECTION_NUM_MENU_ITEMS 2
#define TOP_MENU_NUM_ICONS 2

#define DEVICES_MENU_NUM_SECTIONS 1
#define DEVICES_MENU_NUM_ICONS 2

#define MAX_NUMBER_OF_DEVICES 50
#define MAX_DEVICE_NAME_LENGTH 16

#define MAX_NUMBER_OF_ACTIONS 50
#define MAX_ACTION_NAME_LENGTH 16

#define STATUS_GETTING_STATE 100
#define STATUS_TOGGLING 200

#define TEMP_STRING_LENGTH 15

static Window *loading_window;
static TextLayer *loading_text_layer;

static Window *top_window;
static MenuLayer *top_menu_layer;
static GBitmap *top_menu_icons[TOP_MENU_NUM_ICONS];
static int current_icon = 0;

static Window *devices_window;
static MenuLayer *devices_menu_layer;
static GBitmap *devices_menu_icons[DEVICES_MENU_NUM_ICONS];
static uint8_t deviceCount = 0;

// Handy for using snprintf to display deviceCount
static char tempStr[TEMP_STRING_LENGTH];

enum {
    INDIGO_REMOTE_KEY_GET_DEVICES = 0x1,
    INDIGO_REMOTE_KEY_DEVICE_COUNT = 0x2,
    INDIGO_REMOTE_KEY_DEVICE = 0x3,
    INDIGO_REMOTE_KEY_DEVICE_NUMBER = 0x4,
    INDIGO_REMOTE_KEY_DEVICE_NAME = 0x5,
    INDIGO_REMOTE_KEY_DEVICE_ON = 0x6,
    INDIGO_REMOTE_KEY_DEVICE_TOGGLE_ON_OFF = 0x7,
    INDIGO_REMOTE_KEY_GET_ACTIONS = 0x8
};

typedef struct {
    char name[MAX_DEVICE_NAME_LENGTH];
    uint8_t on;
} DeviceData;

static DeviceData device_data_list[MAX_NUMBER_OF_DEVICES];

typedef struct {
    char name[MAX_ACTION_NAME_LENGTH];
} ActionData;

static ActionData action_data_list[MAX_NUMBER_OF_ACTIONS];


/******* MESSAGE PASSING WITH PHONE BASED PEBBLE APP *******/

static void in_received_handler(DictionaryIterator *iter, void *context) {
    Tuple *device_count_tuple = dict_find(iter, INDIGO_REMOTE_KEY_DEVICE_COUNT);
        Tuple *device_tuple = dict_find(iter, INDIGO_REMOTE_KEY_DEVICE);
    
    if (device_count_tuple) {
        // Got device count, dismiss loading screen
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
        
        window_stack_pop(false);
        window_stack_push(top_window, true /* Animated */);
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


// Request information about the devices known to the Indigo Server
static void devices_msg(void) {
    APP_LOG(APP_LOG_LEVEL_DEBUG, "Attempting to get information about devices");
    Tuplet get_devices_tuple = TupletInteger(INDIGO_REMOTE_KEY_GET_DEVICES, 1);
    
    DictionaryIterator *iter;
    app_message_outbox_begin(&iter);
    
    if (iter == NULL) {
        return;
    }
    
    dict_write_tuplet(iter, &get_devices_tuple);
    dict_write_end(iter);
    
    app_message_outbox_send();
}

// Request to toggle on/off the specified device
static void toggle_msg(uint8_t deviceNumber) {
    APP_LOG(APP_LOG_LEVEL_DEBUG, "Attempting to toggle on/off a device");
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

// Request information about the actions known to the Indigo Server
static void actions_msg(void) {
    APP_LOG(APP_LOG_LEVEL_DEBUG, "Attempting to get information about actions");
    Tuplet get_actions_tuple = TupletInteger(INDIGO_REMOTE_KEY_GET_ACTIONS, 1);
    
    DictionaryIterator *iter;
    app_message_outbox_begin(&iter);
    
    if (iter == NULL) {
        return;
    }
    
    dict_write_tuplet(iter, &get_actions_tuple);
    dict_write_end(iter);
    
    app_message_outbox_send();
}


/******* WATCHAPP UI *******/

// A callback is used to specify the amount of sections of menu items
// With this, you can dynamically add and remove sections
static uint16_t menu_get_num_sections_callback(MenuLayer *menu_layer, void *data) {
    if (menu_layer == top_menu_layer) {
        return TOP_MENU_NUM_SECTIONS;
    }
    else if (menu_layer == devices_menu_layer) {
        return DEVICES_MENU_NUM_SECTIONS;
    }
    else {
        return 0;
    }
}

// Each section has a number of items;  we use a callback to specify this
// You can also dynamically add and remove items using this
static uint16_t menu_get_num_rows_callback(MenuLayer *menu_layer, uint16_t section_index, void *data) {
    if (menu_layer == top_menu_layer) {
        switch (section_index) {
            case 0:
              return TOP_MENU_FIRST_SECTION_NUM_MENU_ITEMS;
            default:
              return 0;
        }
    }
    else if (menu_layer == devices_menu_layer) {
        return deviceCount;
    }
    else {
        return 0;
    }
}

// A callback is used to specify the height of the section header
static int16_t menu_get_header_height_callback(MenuLayer *menu_layer, uint16_t section_index, void *data) {
    // This is a define provided in pebble.h that you may use for the default height
    if (menu_layer == devices_menu_layer) {
        return MENU_CELL_BASIC_HEADER_HEIGHT;
    }
    else {
        return 0;
    }
}

// Here we capture when a user selects a menu item
static void menu_select_callback(MenuLayer *menu_layer, MenuIndex *cell_index, void *data) {
    if (menu_layer == top_menu_layer) {
        // Use the row to specify which item will receive the select action
        switch (cell_index->row) {
            case 0:
                // Go to the devices window
                window_stack_push(devices_window, true /* Animated */);
                break;
            case 1:
                // Cycle the icon
                current_icon = (current_icon + 1) % TOP_MENU_NUM_ICONS;
                // After changing the icon, mark the layer to have it updated
                layer_mark_dirty(menu_layer_get_layer(top_menu_layer));
                break;
        }
    }
    else if (menu_layer == devices_menu_layer) {
        toggle_msg(cell_index->row);
        device_data_list[cell_index->row].on = STATUS_TOGGLING;
        layer_mark_dirty(menu_layer_get_layer(devices_menu_layer));
    }
}

// Here we draw what each header is
static void top_menu_draw_header_callback(GContext* ctx, const Layer *cell_layer, uint16_t section_index, void *data) {
    // Nothing to do - we're not using headers
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
                    menu_cell_basic_draw(ctx, cell_layer, "Devices", "Control devices", top_menu_icons[current_icon]);
                    break;
                    
                case 1:
                    // This is a basic menu item with a title and subtitle
                    menu_cell_basic_draw(ctx, cell_layer, "Actions", "Execute actions", top_menu_icons[(current_icon + 1) % TOP_MENU_NUM_ICONS]);
                    break;
            }
            break;
    }
}

// Here we draw what each header is
static void devices_menu_draw_header_callback(GContext* ctx, const Layer *cell_layer, uint16_t section_index, void *data) {
    // Determine which section we're working with
    switch (section_index) {
        case 0:
            // Draw title text in the section header
            snprintf(tempStr, TEMP_STRING_LENGTH, "%d Devices", deviceCount);
            menu_cell_basic_header_draw(ctx, cell_layer, tempStr);
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

static void loading_timer_callback(void *data) {
    devices_msg();
}

static void loading_timeout_callback(void *data) {
    if (window_stack_get_top_window() == loading_window) {
        text_layer_set_text(loading_text_layer, "Could not\nconnect.");
        layer_mark_dirty(text_layer_get_layer(loading_text_layer));
    }
}

// This initializes the menu upon window load
static void loading_window_load(Window *window) {
    // Now we prepare to initialize the menu layer
    // We need the bounds to specify the menu layer's viewport size
    // In this case, it'll be the same as the window's
    Layer *window_layer = window_get_root_layer(window);
    GRect bounds = layer_get_frame(window_layer);
    
    // Create the text layer
    loading_text_layer = text_layer_create((GRect){ .origin = { 10, 10 }, .size = bounds.size });
    text_layer_set_text(loading_text_layer, "Loading...");
    text_layer_set_font(loading_text_layer, fonts_get_system_font(FONT_KEY_GOTHIC_28));
    
    // Add it to the window for display
    layer_add_child(window_layer, text_layer_get_layer(loading_text_layer));
    
    // Fire off getting the devices info
    app_timer_register(250, loading_timer_callback, NULL);
    
    // Fire off a timeout handler
    app_timer_register(5000, loading_timeout_callback, NULL);
}

static void loading_window_unload(Window *window) {
    // Destroy the text layer
    text_layer_destroy(loading_text_layer);
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
        .get_num_sections = menu_get_num_sections_callback,
        .get_num_rows = menu_get_num_rows_callback,
        .get_header_height = menu_get_header_height_callback,
        .draw_header = top_menu_draw_header_callback,
        .draw_row = top_menu_draw_row_callback,
        .select_click = menu_select_callback,
    });

    // Bind the menu layer's click config provider to the window for interactivity
    menu_layer_set_click_config_onto_window(top_menu_layer, window);

    // Add it to the window for display
    layer_add_child(window_layer, menu_layer_get_layer(top_menu_layer));
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
    // Here we load the bitmap assets
    // resource_init_current_app must be called before all asset loading
    int num_menu_icons = 0;
    devices_menu_icons[num_menu_icons++] = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_MENU_ICON_BIG_WATCH);
    devices_menu_icons[num_menu_icons++] = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_MENU_ICON_SECTOR_WATCH);
    
    // Now we prepare to initialize the menu layer
    // We need the bounds to specify the menu layer's viewport size
    // In this case, it'll be the same as the window's
    Layer *window_layer = window_get_root_layer(window);
    GRect bounds = layer_get_frame(window_layer);

    // Create the menu layer
    devices_menu_layer = menu_layer_create(bounds);

    // Set all the callbacks for the menu layer
    menu_layer_set_callbacks(devices_menu_layer, NULL, (MenuLayerCallbacks){
        .get_num_sections = menu_get_num_sections_callback,
        .get_num_rows = menu_get_num_rows_callback,
        .get_header_height = menu_get_header_height_callback,
        .draw_header = devices_menu_draw_header_callback,
        .draw_row = devices_menu_draw_row_callback,
        .select_click = menu_select_callback,
    });

    // Bind the menu layer's click config provider to the window for interactivity
    menu_layer_set_click_config_onto_window(devices_menu_layer, window);
    
    // Add it to the window for display
    layer_add_child(window_layer, menu_layer_get_layer(devices_menu_layer));
    
    APP_LOG(APP_LOG_LEVEL_DEBUG, "Created Devices Window");
}

static void devices_window_unload(Window *window) {
    // Destroy the menu layer
    menu_layer_destroy(devices_menu_layer);
    
    // Cleanup the menu icons
    for (int i = 0; i < DEVICES_MENU_NUM_ICONS; i++) {
        gbitmap_destroy(devices_menu_icons[i]);
    }
}

int main(void) {
    loading_window = window_create();
    top_window = window_create();
    devices_window = window_create();
    app_message_init();
    
    // Setup the window handlers
    window_set_window_handlers(loading_window, (WindowHandlers) {
        .load = loading_window_load,
        .unload = loading_window_unload,
    });
    window_set_window_handlers(top_window, (WindowHandlers) {
        .load = top_window_load,
        .unload = top_window_unload,
    });
    window_set_window_handlers(devices_window, (WindowHandlers) {
        .load = devices_window_load,
        .unload = devices_window_unload,
    });

    window_stack_push(loading_window, true /* Animated */);
    
    app_event_loop();

    window_destroy(devices_window);
    window_destroy(top_window);
    window_destroy(loading_window);
}