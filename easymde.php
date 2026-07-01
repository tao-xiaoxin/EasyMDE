<?php
/**
 * Plugin Name: EasyMDE
 * Plugin URI: https://github.com/tao-xiaoxin/EasyMDE
 * Description: A standalone WordPress Markdown editor with split-pane live preview.
 * Version: 0.1.7
 * Author: Tao Xiaoxin
 * License: Apache-2.0
 * License URI: https://www.apache.org/licenses/LICENSE-2.0
 * Text Domain: easymde
 */

if (!defined('ABSPATH')) {
    exit;
}

define('EASYMDE_VERSION', '0.1.7');
define('EASYMDE_PLUGIN_FILE', __FILE__);
define('EASYMDE_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('EASYMDE_PLUGIN_URL', plugin_dir_url(__FILE__));

$easymde_autoload = EASYMDE_PLUGIN_DIR . 'vendor/autoload.php';
if (file_exists($easymde_autoload)) {
    require_once $easymde_autoload;
}

require_once EASYMDE_PLUGIN_DIR . 'includes/class-easymde-plugin.php';

add_action('plugins_loaded', array('EasyMDE_Plugin', 'init'));
