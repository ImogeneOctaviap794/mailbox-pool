.PHONY: up down logs ps cert

up:
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f --tail=100

ps:
	docker compose ps

cert:
	./scripts/generate-self-signed-cert.sh mx1.example.com
