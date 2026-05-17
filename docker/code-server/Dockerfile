FROM codercom/code-server:latest

USER root

# Base toolchain + language runtimes for full-stack dev.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl ca-certificates gnupg lsb-release \
        git sudo less jq unzip zip \
        build-essential \
        # --- Python ---
        python3 python3-pip python3-venv pipx \
        # --- PHP CLI + the extensions every PHP project needs ---
        php-cli \
        php-common \
        php-mbstring \
        php-xml \
        php-curl \
        php-zip \
        php-bcmath \
        php-gd \
        php-mysql \
        php-pgsql \
        php-sqlite3 \
        php-redis \
        php-intl \
        # --- Composer (PHP package manager) ---
        composer \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Claude Code CLI — globally available as `claude`.
RUN npm install -g @anthropic-ai/claude-code

# IDE extensions installed for the coder user.  These come from Open VSX
# (code-server's default marketplace), so no licensing issues vs MS Marketplace.
RUN su coder -c "code-server --install-extension dbaeumer.vscode-eslint" \
    && su coder -c "code-server --install-extension esbenp.prettier-vscode" \
    && su coder -c "code-server --install-extension eamodio.gitlens" \
    && su coder -c "code-server --install-extension bmewburn.vscode-intelephense-client" \
    && su coder -c "code-server --install-extension ms-python.python" \
    && su coder -c "code-server --install-extension redhat.vscode-yaml"

RUN mkdir -p /home/coder/projects /home/coder/.config /home/coder/.claude \
    && chown -R coder:coder /home/coder

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER coder
WORKDIR /home/coder

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["code-server", \
     "--bind-addr", "0.0.0.0:8080", \
     "--auth", "password", \
     "--disable-file-downloads", \
     "--disable-telemetry", \
     "--disable-update-check", \
     "/home/coder/projects"]
