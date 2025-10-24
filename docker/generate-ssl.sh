#!/bin/bash

# Move to the SSL directory
cd "$(dirname "$0")/ssl"

# Generate SSL certificate and private key
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx.key \
  -out nginx.crt \
  -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"

echo "SSL certificate and key have been generated in the ssl directory"