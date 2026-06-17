#!/usr/bin/env sh
set -eu

DOMAIN="${1:-mx1.example.com}"

mkdir -p certs

openssl req \
  -x509 \
  -newkey rsa:2048 \
  -sha256 \
  -days 365 \
  -nodes \
  -keyout certs/privkey.pem \
  -out certs/fullchain.pem \
  -subj "/CN=${DOMAIN}"

echo "Generated certs/fullchain.pem and certs/privkey.pem for ${DOMAIN}"
