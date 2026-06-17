#!/bin/sh
set -eu

: "${MAIL_HOSTNAME:=mx1.wyzaione.com}"
: "${DB_HOST:=postgres}"
: "${DB_NAME:=mailserver}"
: "${DB_USER:=mail}"
: "${DB_PASSWORD:=mailpass}"

sed \
  -e "s|__MAIL_HOSTNAME__|${MAIL_HOSTNAME}|g" \
  /etc/postfix/main.cf.template > /etc/postfix/main.cf

sed \
  -e "s|__DB_HOST__|${DB_HOST}|g" \
  -e "s|__DB_NAME__|${DB_NAME}|g" \
  -e "s|__DB_USER__|${DB_USER}|g" \
  -e "s|__DB_PASSWORD__|${DB_PASSWORD}|g" \
  /etc/postfix/pgsql-virtual-domains.cf.template > /etc/postfix/pgsql-virtual-domains.cf

sed \
  -e "s|__DB_HOST__|${DB_HOST}|g" \
  -e "s|__DB_NAME__|${DB_NAME}|g" \
  -e "s|__DB_USER__|${DB_USER}|g" \
  -e "s|__DB_PASSWORD__|${DB_PASSWORD}|g" \
  /etc/postfix/pgsql-virtual-mailboxes.cf.template > /etc/postfix/pgsql-virtual-mailboxes.cf

chmod 640 /etc/postfix/pgsql-virtual-domains.cf /etc/postfix/pgsql-virtual-mailboxes.cf

# Copy DNS resolver config into Postfix chroot so pgsql lookups can resolve Docker hostnames
cp /etc/resolv.conf /var/spool/postfix/etc/resolv.conf
cp /etc/nsswitch.conf /var/spool/postfix/etc/nsswitch.conf
cp /etc/services /var/spool/postfix/etc/services

exec postfix start-fg
