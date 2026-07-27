FROM composer:2 AS composer_runtime

FROM php:8.3-cli

ARG EASYMDE_CI_NODE_VERSION=20.19.0
ARG EASYMDE_CI_WORDPRESS_VERSION=6.7

LABEL org.opencontainers.image.title="EasyMDE local CI"
LABEL org.opencontainers.image.description="Reusable offline PHP, Node, and WordPress test runtime for EasyMDE"
LABEL org.opencontainers.image.version="${EASYMDE_CI_WORDPRESS_VERSION}-php8.3-node${EASYMDE_CI_NODE_VERSION}"

COPY --from=composer_runtime /usr/bin/composer /usr/local/bin/composer

RUN docker-php-ext-install mysqli

COPY resources/node/ /opt/node/
COPY resources/wordpress-core/ /opt/easymde/wordpress/
COPY resources/wordpress-tests-lib/ /opt/easymde/wordpress-tests-lib/

ENV PATH="/opt/node/bin:${PATH}"
ENV WP_CORE_DIR="/opt/easymde/wordpress"
ENV WP_TESTS_DIR="/opt/easymde/wordpress-tests-lib"

RUN sed -i \
        -e "s#dirname( __FILE__ ) . '/src/'#'/opt/easymde/wordpress/'#" \
        -e "s/youremptytestdbnamehere/easymde_phpunit/" \
        -e "s/yourusernamehere/root/" \
        -e "s/yourpasswordhere/root/" \
        -e "s/'localhost'/'easymde-ci-db:3306'/" \
        /opt/easymde/wordpress-tests-lib/wp-tests-config.php \
    && php -m | grep -qx mysqli \
    && /opt/node/bin/node --version \
    && /opt/node/bin/npm --version \
    && composer --version \
    && test -f /opt/easymde/wordpress/wp-settings.php \
    && test -f /opt/easymde/wordpress-tests-lib/includes/functions.php

WORKDIR /workspace

CMD ["bash"]
