#!/bin/sh
set -eu

: "${MAIL_HOSTNAME:=imap.wyzaione.com}"
: "${DB_HOST:=postgres}"
: "${DB_NAME:=mailserver}"
: "${DB_USER:=mail}"
: "${DB_PASSWORD:=mailpass}"

sed \
  -e "s|__MAIL_HOSTNAME__|${MAIL_HOSTNAME}|g" \
  /etc/dovecot/dovecot.conf.template > /etc/dovecot/dovecot.conf

sed \
  -e "s|__DB_HOST__|${DB_HOST}|g" \
  -e "s|__DB_NAME__|${DB_NAME}|g" \
  -e "s|__DB_USER__|${DB_USER}|g" \
  -e "s|__DB_PASSWORD__|${DB_PASSWORD}|g" \
  /etc/dovecot/dovecot-sql.conf.ext.template > /etc/dovecot/dovecot-sql.conf.ext

chmod 640 /etc/dovecot/dovecot-sql.conf.ext
chown root:dovecot /etc/dovecot/dovecot-sql.conf.ext
chown -R vmail:vmail /var/vmail

exec dovecot -F
