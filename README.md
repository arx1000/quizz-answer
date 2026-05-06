# Quiz Answer Bot 🤖📝

AI-powered bot that automatically answers quizzes using Groq API (free!).

## Features
- Uses free Groq API for AI answers
- Supports radio buttons, checkboxes, custom buttons
- Works on any quiz website
- Manual login support for sites that need authentication

## Setup

```bash
npm install
npx playwright install chromium
```

## Usage

```bash
# Basic (random answers)
node src/quizBot.cjs --url "https://example.com/quiz"

# With AI (correct answers)
node src/quizBot.cjs --url "QUIZ_URL" --ai-key "gsk_..."

# For sites needing login
node src/quizBot.cjs --url "QUIZ_URL" --ai-key "KEY" --wait-login --stay-open

# Test locally
node src/quizBot.cjs --serve test-pages --url real-quiz.html --ai-key "YOUR_GROQ_KEY"
```

## Get Free API Key
1. Go to https://console.groq.com
2. Sign up (free account)
3. Copy your API key from API Keys page

## Options
- `--url` - Quiz URL (required)
- `--ai-key` - Groq API key (get free at console.groq.com)
- `--serve` - Serve local folder
- `--wait-login` - Let you log in manually first
- `--stay-open` - Keep browser open after completion
- `--headless` - Run hidden (default is visible)

## Test
A local test quiz is included in `test-pages/real-quiz.html` with 3 questions:
1. What is the capital of France? (Paris)
2. What is 2 + 2? (4)
3. Which is a planet? (Earth)

Run: `node src/quizBot.cjs --serve test-pages --url real-quiz.html --ai-key YOUR_KEY`

## License
MIT