FROM codercom/code-server:latest

USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
        git \
        sudo \
        less \
        jq \
        build-essential \
        python3 \
        python3-pip \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

RUN su coder -c "code-server --install-extension dbaeumer.vscode-eslint" \
    && su coder -c "code-server --install-extension esbenp.prettier-vscode" \
    && su coder -c "code-server --install-extension eamodio.gitlens"

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
