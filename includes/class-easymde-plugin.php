<?php

if (!defined('ABSPATH')) {
    exit;
}

if (!class_exists('EasyMDE_Plugin')) {
    class EasyMDE_Plugin extends \EasyMDE\Support\LegacyPluginFacade
    {
    }
}
