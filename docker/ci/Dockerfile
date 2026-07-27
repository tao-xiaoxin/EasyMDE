FROM composer@sha256:5946476338742b200bb9ff88f8be56275ddae4b3949c72305cb0dbf10cfcb760 AS composer_runtime

FROM php@sha256:2a3f699b6cb31e5638c5432e4d37d4047853ba6351a692c91e0a073af00a55cc

ARG EASYMDE_CI_NODE_VERSION=20.19.0
ARG EASYMDE_CI_WORDPRESS_VERSION=6.7
ARG EASYMDE_CI_COMPOSER_LOCK_SHA256
ARG EASYMDE_CI_WP_CORE_SHA256
ARG EASYMDE_CI_WP_TESTS_SHA256

LABEL org.opencontainers.image.title="EasyMDE local CI"
LABEL org.opencontainers.image.description="Reusable offline PHP, Node, and WordPress test runtime for EasyMDE"
LABEL org.opencontainers.image.version="${EASYMDE_CI_WORDPRESS_VERSION}-php8.3-node${EASYMDE_CI_NODE_VERSION}"
LABEL org.opencontainers.image.easymde-composer-lock-sha256="${EASYMDE_CI_COMPOSER_LOCK_SHA256}"
LABEL org.opencontainers.image.easymde-wordpress-core-sha256="${EASYMDE_CI_WP_CORE_SHA256}"
LABEL org.opencontainers.image.easymde-wordpress-tests-sha256="${EASYMDE_CI_WP_TESTS_SHA256}"

COPY --from=composer_runtime /usr/bin/composer /usr/local/bin/composer

RUN docker-php-ext-install mysqli

COPY resources/composer-project/ /opt/easymde/composer-project/
COPY resources/easymde-phpunit /usr/local/bin/easymde-phpunit
COPY resources/node/ /opt/node/
COPY resources/wordpress-core/ /opt/easymde/wordpress/
COPY resources/wordpress-tests-lib/ /opt/easymde/wordpress-tests-lib/

ENV PATH="/opt/node/bin:${PATH}"
ENV EASYMDE_CI_COMPOSER_LOCK_SHA256="${EASYMDE_CI_COMPOSER_LOCK_SHA256}"
ENV EASYMDE_CI_WP_CORE_SHA256="${EASYMDE_CI_WP_CORE_SHA256}"
ENV EASYMDE_CI_WP_TESTS_SHA256="${EASYMDE_CI_WP_TESTS_SHA256}"
ENV EASYMDE_PHPUNIT_VENDOR_DIR="/opt/easymde/composer-project/vendor"
ENV WP_CORE_DIR="/opt/easymde/wordpress"
ENV WP_TESTS_DIR="/opt/easymde/wordpress-tests-lib"

RUN php -m | grep -qx mysqli \
    && test "$(php -r 'echo PHP_VERSION;')" = "8.3.32" \
    && test "$(php -r "require '/opt/easymde/wordpress/wp-includes/version.php'; echo \$wp_version;")" = "6.7" \
    && /opt/node/bin/node --version \
    && /opt/node/bin/npm --version \
    && test "$(composer --version --no-ansi | awk '{print $3}')" = "2.10.2" \
    && /opt/easymde/composer-project/vendor/bin/phpunit --version \
    && test -f /opt/easymde/composer-project/vendor/yoast/phpunit-polyfills/phpunitpolyfills-autoload.php \
    && test "$(sha256sum /opt/easymde/composer-project/composer.lock | awk '{print $1}')" = "${EASYMDE_CI_COMPOSER_LOCK_SHA256}" \
    && test "$(cd /opt/easymde/wordpress && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}')" = "${EASYMDE_CI_WP_CORE_SHA256}" \
    && test "$(cd /opt/easymde/wordpress-tests-lib && find includes data -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}')" = "${EASYMDE_CI_WP_TESTS_SHA256}" \
    && test -x /usr/local/bin/easymde-phpunit \
    && test -f /opt/easymde/wordpress/wp-settings.php \
    && test -f /opt/easymde/wordpress-tests-lib/includes/functions.php

WORKDIR /workspace

CMD ["bash"]
