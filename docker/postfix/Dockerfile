FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && echo "postfix postfix/mailname string localhost" | debconf-set-selections \
    && echo "postfix postfix/main_mailer_type string 'Internet Site'" | debconf-set-selections \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        gettext-base \
        postfix \
        postfix-pgsql \
    && rm -rf /var/lib/apt/lists/*

COPY main.cf.template /etc/postfix/main.cf.template
COPY pgsql-virtual-domains.cf.template /etc/postfix/pgsql-virtual-domains.cf.template
COPY pgsql-virtual-mailboxes.cf.template /etc/postfix/pgsql-virtual-mailboxes.cf.template
COPY entrypoint.sh /entrypoint.sh

RUN chmod 755 /entrypoint.sh

EXPOSE 25

ENTRYPOINT ["/entrypoint.sh"]
