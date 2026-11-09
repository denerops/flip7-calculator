# Flip 7

Duas formas de jogar, do mesmo app:

- **Marcador de mesa**: cartas de verdade na mesa. Toque as cartas de cada mão e o app soma e ordena o placar. A partida fica salva no navegador, sem conta e sem servidor.
- **Jogar online**: crie uma sala, mande o link e jogue com os amigos. Quem entra escolhe o nome e recebe cartas do baralho de verdade.

## Como a conta funciona

No marcador, a ordem da conta é:

1. soma dos números
2. ×2, se a carta estiver na mão (dobra só os números)
3. modificadores +2, +4, +6, +8 e +10
4. +30 se saíram 7 números diferentes

Quem estourou fica com 0. A partida fecha quando alguém passa de 200 e fica sozinho na frente.

## Jogo online

O baralho é o oficial, com 94 cartas: um 0, um 1, dois 2, três 3 e assim até doze 12 (79 números), +2 +4 +6 +8 +10 e ×2 (6 modificadores) e três de cada ação: Freeze, Flip Three e Second Chance.

- Cada jogador recebe uma carta no começo da rodada e escolhe **pedir carta** ou **parar**.
- **Freeze** congela um jogador, que guarda os pontos e sai da rodada.
- **Flip Three** faz alguém comprar três cartas de uma vez.
- **Segunda Chance** salva de um número repetido, uma vez só.
- Número repetido sem Segunda Chance estoura a rodada: vale 0.
- Sete números diferentes fecham a rodada na hora e valem +30.
- A sala mostra o placar acumulado e quem está na vez.

O nome da sala vira o código: um grupo pode usar sempre a mesma sala. O nome do jogador fica salvo no aparelho, então só é pedido na primeira vez.

## Supabase

As salas ficam no projeto `flip7-calculator`. A chave usada no `net.js` é a pública, que pode ficar no frontend. O banco tem uma tabela só:

- `rooms`: código da sala, nome, a partida inteira em JSON e uma versão para evitar gravações simultâneas.

O esquema completo está em `supabase/schema.sql`. Para recriar do zero, rode esse arquivo no SQL Editor do Supabase. O realtime da tabela `rooms` precisa estar ligado (o arquivo já faz isso), e o app também confere a sala de tempos em tempos, caso o tempo real falhe.

Não há login: qualquer pessoa com o código entra na sala. É um jogo de mesa entre amigos.

## Publicar no GitHub Pages

1. Envie esta pasta para um repositório.
2. Em **Settings → Pages**, escolha **Deploy from a branch**.
3. Branch `main` (ou `master`) e pasta **`/ (root)`**.
4. Abra o endereço que o Pages mostrar. Os caminhos são relativos, então funciona em `usuario.github.io/repositorio/`.

Para instalar na tela de início: no Android, o Chrome oferece instalar; no iPhone, Compartilhar → Adicionar à Tela de Início. Depois da primeira abertura online, o marcador abre sem rede.
