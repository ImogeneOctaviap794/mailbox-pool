# DNS Template for `wyzaione.com`

Replace `YOUR_SERVER_IPV4` and `YOUR_SERVER_IPV6` first.

## A/AAAA

```txt
mx1.wyzaione.com.      300 IN A      YOUR_SERVER_IPV4
mx2.wyzaione.com.      300 IN A      YOUR_SERVER_IPV4
imap.wyzaione.com.     300 IN A      YOUR_SERVER_IPV4

mx1.wyzaione.com.      300 IN AAAA   YOUR_SERVER_IPV6
mx2.wyzaione.com.      300 IN AAAA   YOUR_SERVER_IPV6
imap.wyzaione.com.     300 IN AAAA   YOUR_SERVER_IPV6
```

## MX

`*.wyzaione.com` needs to receive mail. Add:

```txt
*.wyzaione.com.        300 IN MX 10  mx1.wyzaione.com.
*.wyzaione.com.        300 IN MX 20  mx2.wyzaione.com.
```

You may also add explicit records for root fallback:

```txt
wyzaione.com.          300 IN MX 10  mx1.wyzaione.com.
wyzaione.com.          300 IN MX 20  mx2.wyzaione.com.
```

## SPF

If this server also sends mail:

```txt
wyzaione.com.          300 IN TXT "v=spf1 mx -all"
```

If receive-only right now, SPF can still be preconfigured for future sending policy.

## DKIM (for sending, optional now)

After you generate DKIM keys, publish:

```txt
mail._domainkey.wyzaione.com. 300 IN TXT "v=DKIM1; k=rsa; p=YOUR_PUBLIC_KEY"
```

## DMARC

```txt
_dmarc.wyzaione.com.   300 IN TXT "v=DMARC1; p=none; rua=mailto:dmarc@wyzaione.com; fo=1"
```

## Reverse DNS (PTR)

Set provider PTR for your server IP:

```txt
YOUR_SERVER_IPV4 -> mx1.wyzaione.com
```

## Important DNS Behavior

- `mail.*.wyzaione.com` is not valid DNS wildcard syntax.
- DNS wildcard only allows `*` in the left-most label, for example `*.wyzaione.com`.
- Your mailbox creation rule should enforce domains in the form `mail.<tenant>.wyzaione.com`.
