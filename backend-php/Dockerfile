# =============================================================
#  AetherCore-Web3 | /backend-php/Dockerfile
#  Builds a PHP 8.2 + Apache image with PDO MySQL extension.
# =============================================================

FROM php:8.2-apache

# ── Install PHP Extensions ─────────────────────────────────────
RUN docker-php-ext-install pdo pdo_mysql

# ── Enable Apache mod_rewrite (required for URL routing) ───────
RUN a2enmod rewrite

# ── Configure Apache to allow .htaccess overrides ──────────────
RUN sed -i '/<Directory \/var\/www\/>/,/<\/Directory>/ s/AllowOverride None/AllowOverride All/' \
    /etc/apache2/apache2.conf

# ── Install Composer ────────────────────────────────────────────
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# ── Set working directory ───────────────────────────────────────
WORKDIR /var/www/html

# ── Copy source (overridden by mount in docker-compose) ────────
COPY . .

# ── Install PHP dependencies ────────────────────────────────────
RUN composer install --no-interaction --prefer-dist --optimize-autoloader 2>/dev/null || true

EXPOSE 80
