# Finternet Payment Frontend

Wallet connection interface for Finternet Payment Gateway. This frontend allows users to connect their wallet and execute payment transactions.

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ or Bun
- MetaMask browser extension (for wallet connection)

### Installation

```bash
cd frontend
bun install
# OR
npm install
```

### Configuration

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Update `.env`:
```bash
VITE_API_BASE_URL=http://localhost:3000/api/v1
```

### Development

```bash
bun run dev
# OR
npm run dev
```

The frontend will be available at `http://localhost:5173`

### Build for Production

```bash
bun run build
# OR
npm run build
```

Built files will be in the `dist/` directory, ready to be deployed to Vercel, Netlify, or any static hosting.

## 📖 Usage

### Payment URL Format

Users access the payment page via:
```
http://localhost:5173/?intent=intent_xxx
```

Where `intent_xxx` is the payment intent ID returned by the API.

### Flow

1. **Load Payment Intent**: Fetches payment details from API
2. **Connect Wallet**: User connects MetaMask wallet
3. **Approve Tokens** (if needed): Approve contract to spend ERC-20 tokens
4. **Execute Payment**: User executes contract function from their wallet
5. **Success**: Transaction hash displayed, payment intent status updated

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_BASE_URL` | Backend API base URL | `http://localhost:3000/api/v1` |
| `VITE_PAYEE_ADDRESS` | Payee address for DvP (optional) | Connected wallet address |

### API Integration

**Note**: The current API requires API key authentication. For the payment page, you have two options:

1. **Create a public endpoint** in the API that validates payment intent IDs without API key
2. **Proxy through your backend** to add API key authentication server-side
3. **Embed API key in query parameter** (less secure, only for demos)

## 🏗️ Project Structure

```
frontend/
├── src/
│   ├── components/
│   │   ├── PaymentPage.tsx      # Main payment interface
│   │   └── PaymentPage.css      # Styles
│   ├── services/
│   │   ├── api.client.ts        # API client
│   │   └── wallet.service.ts    # Wallet connection & contract interaction
│   ├── App.tsx                  # Root component
│   ├── App.css
│   ├── main.tsx                 # Entry point
│   └── index.css                # Global styles
├── index.html
├── vite.config.ts
├── tsconfig.json
└── package.json
```

## 🔒 Security Notes

- **Wallet Connection**: Users must connect their own wallet (MetaMask)
- **Transaction Execution**: All transactions execute from user's wallet
- **No Private Keys**: Frontend never stores or accesses private keys
- **API Authentication**: Consider adding a public endpoint for payment intent retrieval

## 🚀 Deployment

### Vercel

```bash
vercel deploy
```

### Netlify

```bash
netlify deploy --prod
```

### Static Hosting

Build the project and upload the `dist/` folder to any static hosting service (Cloudflare Pages, GitHub Pages, etc.).

## 🔗 Integration with API

Update the API's `.env` to point to your deployed frontend:

```bash
FRONTEND_URL=https://your-frontend-domain.com
```

This will ensure the API returns the correct `paymentUrl` in payment intent responses.

---

Built for Finternet Hackathon 🚀

