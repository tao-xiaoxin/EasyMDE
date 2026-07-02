<?php

function easymde_verify_i18n_fail($message)
{
    fwrite(STDERR, $message . PHP_EOL);
    exit(1);
}

if (!defined('ABSPATH')) {
    easymde_verify_i18n_fail('WordPress is not loaded.');
}

if (!did_action('init')) {
    easymde_verify_i18n_fail('EasyMDE i18n verification must run after WordPress init.');
}

if (false !== has_action('plugins_loaded', array('EasyMDE_Plugin', 'init'))) {
    easymde_verify_i18n_fail('EasyMDE must not initialize on plugins_loaded.');
}

if (false === has_action('init', array('EasyMDE_Plugin', 'init'))) {
    easymde_verify_i18n_fail('EasyMDE init hook is not registered on init.');
}

if (class_exists('EasyMDE\Support\LegacyTranslations', false)) {
    easymde_verify_i18n_fail('LegacyTranslations is loaded.');
}

if (has_filter('gettext_easymde')) {
    easymde_verify_i18n_fail('gettext_easymde filter is registered.');
}

$zh_cn_locale = function () {
    return 'zh_CN';
};

add_filter('locale', $zh_cn_locale, 999);
add_filter('determine_locale', $zh_cn_locale, 999);
unload_textdomain('easymde');

$translated = __('Shortcut settings', 'easymde');
if ('快捷键设置' !== $translated) {
    easymde_verify_i18n_fail('Bundled zh_CN MO did not translate "Shortcut settings"; got: ' . $translated);
}

if (!is_textdomain_loaded('easymde')) {
    easymde_verify_i18n_fail('The easymde text domain was not loaded by WordPress.');
}

remove_filter('locale', $zh_cn_locale, 999);
remove_filter('determine_locale', $zh_cn_locale, 999);
unload_textdomain('easymde');

$en_us_locale = function () {
    return 'en_US';
};

add_filter('locale', $en_us_locale, 999);
add_filter('determine_locale', $en_us_locale, 999);

$english = __('Shortcut settings', 'easymde');
if ('Shortcut settings' !== $english) {
    easymde_verify_i18n_fail('en_US unexpectedly received a translated EasyMDE string; got: ' . $english);
}

remove_filter('locale', $en_us_locale, 999);
remove_filter('determine_locale', $en_us_locale, 999);
unload_textdomain('easymde');

fwrite(STDOUT, 'EasyMDE WordPress i18n runtime verification passed.' . PHP_EOL);
