FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        dovecot-core \
        dovecot-imapd \
        dovecot-lmtpd \
        dovecot-pgsql \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -g 5000 vmail \
    && useradd -u 5000 -g vmail -m -d /var/vmail vmail \
    && mkdir -p /var/vmail \
    && chown -R vmail:vmail /var/vmail

COPY dovecot.conf.template /etc/dovecot/dovecot.conf.template
COPY dovecot-sql.conf.ext.template /etc/dovecot/dovecot-sql.conf.ext.template
COPY entrypoint.sh /entrypoint.sh

RUN chmod 755 /entrypoint.sh

EXPOSE 143 993 24

ENTRYPOINT ["/entrypoint.sh"]
