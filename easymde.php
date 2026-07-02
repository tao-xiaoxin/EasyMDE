<?php
/**
 * Plugin Name: EasyMDE
 * Plugin URI: https://github.com/tao-xiaoxin/EasyMDE
 * Description: A standalone WordPress Markdown editor with split-pane live preview.
 * Version: 0.1.7
 * Author: Tao Xiaoxin
 * Requires at least: 6.9
 * Requires PHP: 7.4
 * License: Apache-2.0
 * License URI: https://www.apache.org/licenses/LICENSE-2.0
 * Text Domain: easymde
 * Domain Path: /languages
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

spl_autoload_register(
    function ($class) {
        $prefix = 'EasyMDE\\';
        if (0 !== strpos($class, $prefix)) {
            return;
        }

        $relative_class = substr($class, strlen($prefix));
        $file = EASYMDE_PLUGIN_DIR . 'src/' . str_replace('\\', '/', $relative_class) . '.php';
        if (file_exists($file)) {
            require_once $file;
        }
    }
);

require_once EASYMDE_PLUGIN_DIR . 'includes/class-easymde-plugin.php';

add_action('init', array('EasyMDE_Plugin', 'init'));
