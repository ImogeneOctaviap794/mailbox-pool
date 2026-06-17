Place your TLS certificate and private key files here:

- `fullchain.pem`
- `privkey.pem`

For production, use a CA-issued certificate (for example Let's Encrypt).

For local testing only, run:

```bash
./scripts/generate-self-signed-cert.sh mx1.example.com
```
