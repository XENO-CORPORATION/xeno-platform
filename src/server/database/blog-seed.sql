-- Blog seed data for xenostudio.ai
-- Run once to populate the blog_posts table with initial content

INSERT INTO blog_posts (slug, title, excerpt, content, cover_image, category, tags, author_name, published, published_at)
VALUES

-- ANNOUNCEMENT posts
(
  'introducing-xeno-studio',
  'Introducing XENO Studio: One Platform for Every Creative AI Tool',
  'XENO Studio brings together image generation, video editing, chat, code execution, and more into a single unified workspace. No more juggling between dozens of AI tools.',
  E'# Introducing XENO Studio\n\nWe built XENO Studio because the AI landscape has become fragmented. Creators jump between ChatGPT for text, Midjourney for images, Runway for video, and a dozen other tools — each with its own subscription, interface, and learning curve.\n\nXENO Studio is a single workspace that brings all of these capabilities together:\n\n- **Chat** with GPT-4, Claude, Gemini, DeepSeek, Llama, and more — all in one interface\n- **Generate images** with Stable Diffusion, Flux, and DALL-E\n- **Edit and generate video** with built-in tools\n- **Execute code** in a sandboxed environment\n- **Convert files**, create documents, and browse the web with AI assistance\n\n## Why a unified platform?\n\nContext switching kills creativity. When you have to export from one tool, import into another, and mentally translate between different UIs, you lose the flow state that produces great work.\n\nXENO Studio keeps everything in one place. Your chat history, your generated images, your code — all accessible from a single workspace.\n\n## Available now\n\nXENO Studio is live at [xenostudio.ai](https://xenostudio.ai). The web app is free to start, and XENO Hub — our desktop application — brings the full experience to your Mac, Windows, or Linux machine.\n\nWe are just getting started.',
  NULL,
  'announcement',
  ARRAY['launch', 'platform', 'ai'],
  'XENO Team',
  true,
  '2026-03-01 10:00:00'
),

(
  'xeno-hub-desktop-app-launch',
  'XENO Hub: The Desktop App That Puts AI at Your Fingertips',
  'XENO Hub is now available for macOS, Windows, and Linux. A native desktop experience for all of XENO Studio''s AI capabilities, with offline support and system-level integration.',
  E'# XENO Hub Desktop App\n\nToday we are releasing XENO Hub, the desktop companion to XENO Studio.\n\nWhile xenostudio.ai gives you the full experience in your browser, XENO Hub goes further:\n\n- **Native performance** — built for your OS, not constrained by a browser tab\n- **System integration** — drag and drop files, keyboard shortcuts, notification support\n- **Offline capabilities** — work with local models when you don''t have internet\n- **Multi-window support** — run chat, image generation, and code side by side\n\n## Download\n\nXENO Hub is available now for:\n- macOS (Apple Silicon and Intel)\n- Windows 10/11\n- Linux (AppImage and .deb)\n\nVisit [xenostudio.ai/download](https://xenostudio.ai/download) to get started.\n\n## What''s included\n\nEverything from the web app, plus desktop-exclusive features like local model support, file system access, and deeper OS integration. Your workspace syncs automatically between web and desktop.',
  NULL,
  'announcement',
  ARRAY['desktop', 'hub', 'launch'],
  'XENO Team',
  true,
  '2026-03-05 10:00:00'
),

-- RELEASE posts
(
  'release-notes-march-2026',
  'March 2026 Release Notes: Office Canvas, Video Generation, and More',
  'This month we shipped Office Canvas for document creation, integrated video generation models, and added support for 15 new AI models across all providers.',
  E'# March 2026 Release Notes\n\nHere is everything we shipped in March:\n\n## Office Canvas\n\nA new document creation workspace powered by AI. Write, format, and export professional documents with LaTeX-quality rendering. Supports:\n- PDF export with full formatting\n- Real-time collaboration\n- AI-assisted writing and editing\n- Template library for common document types\n\n## Video Generation\n\nGoogle''s latest video generation models are now available directly in XENO Studio:\n- **Veo** — high-quality video from text prompts\n- Built-in video editing timeline\n- Export in multiple formats and resolutions\n\n## New Models\n\nWe added support for 15 new models this month:\n- Gemini 2.5 Pro and Flash\n- Claude 3.7 Sonnet\n- GPT-4.1 and GPT-4.1 Mini\n- DeepSeek V3\n- Llama 4 Scout and Maverick\n- And more\n\n## Bug Fixes\n\n- Fixed file upload timeout for large files\n- Improved WebSocket reconnection logic\n- Fixed image generation context blending\n- Resolved chat history pagination issues',
  NULL,
  'release',
  ARRAY['release-notes', 'office', 'video', 'models'],
  'XENO Team',
  true,
  '2026-03-28 10:00:00'
),

(
  'release-notes-april-2026',
  'April 2026 Release Notes: Workspaces, Project Policies, and API Usage Tracking',
  'We launched multi-tenant workspaces with team roles, project-level model policies, and detailed API usage analytics for billing transparency.',
  E'# April 2026 Release Notes\n\n## Workspaces and Teams\n\nXENO Studio now supports multi-user workspaces:\n- Create workspaces for your team or organization\n- Invite members with role-based access (owner, admin, member)\n- Each workspace gets its own usage tracking and billing\n\n## Project Policies\n\nAdmins can now set model access policies per project:\n- Allow or block specific AI models\n- Set rate limits per project\n- Control which team members can access which capabilities\n\n## API Usage Dashboard\n\nA new analytics dashboard shows exactly how your team uses AI:\n- Token usage breakdown by model and user\n- Cost tracking per workspace and project\n- Export usage data for reporting\n\n## Other Improvements\n\n- Improved chat streaming performance\n- Better error messages for rate limits\n- Fixed workspace slug collision edge case\n- Added keyboard shortcuts for common actions',
  NULL,
  'release',
  ARRAY['release-notes', 'workspaces', 'billing', 'api'],
  'XENO Team',
  true,
  '2026-04-07 10:00:00'
),

-- TUTORIAL posts
(
  'getting-started-with-xeno-studio',
  'Getting Started with XENO Studio: A Complete Beginner''s Guide',
  'Learn how to set up your XENO Studio account, navigate the workspace, and start using AI for chat, image generation, and code execution in under 10 minutes.',
  E'# Getting Started with XENO Studio\n\nThis guide will walk you through everything you need to know to start using XENO Studio.\n\n## Step 1: Create Your Account\n\nVisit [xenostudio.ai](https://xenostudio.ai) and sign up with your email, Google, GitHub, or X account.\n\n## Step 2: Explore the Workspace\n\nAfter signing in, you will see the main workspace with these sections:\n- **Chat** — converse with any AI model\n- **Generate** — create images and video\n- **Office** — create and edit documents\n- **Code** — write and execute code in a sandbox\n- **Browser** — browse the web with AI assistance\n\n## Step 3: Start a Chat\n\nClick on Chat, select a model from the dropdown, and type your message. You can:\n- Switch models mid-conversation\n- Upload images for vision-capable models\n- Enable reasoning mode for complex tasks\n- Export conversations\n\n## Step 4: Generate an Image\n\nSwitch to the Generate tab, type a description of what you want to create, select a model (Flux, Stable Diffusion, or DALL-E), and click Generate.\n\n## Step 5: Try the Desktop App\n\nFor the best experience, download XENO Hub from [xenostudio.ai/download](https://xenostudio.ai/download). It offers native performance, offline model support, and system integration.\n\n## Need help?\n\nJoin our community or check the documentation at xenostudio.ai/docs.',
  NULL,
  'tutorial',
  ARRAY['beginner', 'guide', 'getting-started'],
  'XENO Team',
  true,
  '2026-03-10 10:00:00'
),

(
  'mastering-ai-image-generation',
  'Mastering AI Image Generation: Prompts, Models, and Workflows',
  'A deep dive into getting the best results from Flux, Stable Diffusion, and DALL-E inside XENO Studio. Learn prompt engineering, model selection, and advanced techniques.',
  E'# Mastering AI Image Generation in XENO Studio\n\nImage generation has come a long way, but getting consistently great results still requires understanding how to communicate with the models. Here is what we have learned.\n\n## Choosing the Right Model\n\n**Flux** — Best for photorealistic images and complex scenes. Excellent at following detailed prompts.\n\n**Stable Diffusion** — Great for artistic styles, fast iteration, and fine-tuned models. More control over the generation process.\n\n**DALL-E** — Strong at understanding natural language descriptions and producing clean, commercially-useful images.\n\n## Prompt Engineering Basics\n\n1. **Be specific** — "A golden retriever running on a beach at sunset, shot on 35mm film" beats "dog on beach"\n2. **Describe the style** — "oil painting", "3D render", "watercolor illustration"\n3. **Include technical details** — "shallow depth of field", "dramatic lighting", "bird''s eye view"\n4. **Use negative prompts** — specify what you do NOT want in the image\n\n## Advanced Techniques\n\n### Image-to-Image\nUpload a reference image and describe how you want it modified. Great for iterating on a concept.\n\n### Context Blending\nXENO Studio lets you combine multiple reference images into a single generation. Use the context panel to add and describe each reference.\n\n### Batch Generation\nGenerate multiple variations at once to explore different directions quickly.\n\n## Common Mistakes\n\n- Overly long prompts that contradict themselves\n- Not specifying aspect ratio or composition\n- Using vague style descriptors\n- Ignoring negative prompts',
  NULL,
  'tutorial',
  ARRAY['image-generation', 'prompts', 'flux', 'stable-diffusion'],
  'XENO Team',
  true,
  '2026-03-18 10:00:00'
),

-- UPDATE posts
(
  'new-models-gemini-3-claude-4',
  'New Models Available: Gemini 3.1 Pro, Claude Opus 4.6, and GPT-5.4',
  'We have added the latest models from Google, Anthropic, and OpenAI. Access Gemini 3.1 Pro, Claude Opus 4.6, GPT-5.4 Pro, and more directly in your workspace.',
  E'# New Models Now Available\n\nWe have updated our model catalog with the latest releases from every major provider:\n\n## Google\n- **Gemini 3.1 Pro Preview** — Google''s most capable model with 1M token context\n- **Gemini 3 Flash Preview** — Fast and efficient for everyday tasks\n- **Gemini 3.1 Flash Lite Preview** — Ultra-fast for simple queries\n\n## Anthropic\n- **Claude Opus 4.6** — Anthropic''s flagship model\n- **Claude Opus 4.5** — Excellent balance of capability and speed\n- **Claude Haiku 4.5** — Fast and affordable\n\n## OpenAI\n- **GPT-5.4 Pro** — OpenAI''s most powerful model\n- **GPT-5.4** — Strong general-purpose model\n- **GPT-5.4 Mini and Nano** — Efficient options for simpler tasks\n\n## Others\n- DeepSeek V3.2 Speciale and V3.2\n- Llama 4 Maverick and Scout\n- Grok 4.20 Multi-Agent Beta\n- Mistral Small 4 and Devstral 2\n- Qwen 3.5\n\nAll models are available now in both the web app and XENO Hub. Select them from the model dropdown in any chat window.',
  NULL,
  'update',
  ARRAY['models', 'gemini', 'claude', 'gpt'],
  'XENO Team',
  true,
  '2026-04-02 10:00:00'
),

(
  'xeno-search-ai-powered-web-search',
  'XENO Search: AI-Powered Web Search Inside Your Workspace',
  'We built XENO Search to give AI models real-time access to the web. Ask questions about current events, research topics, or anything that needs up-to-date information.',
  E'# XENO Search\n\nAI models have a knowledge cutoff. They do not know about events that happened after their training data was collected. XENO Search fixes this.\n\n## How it works\n\nXENO Search is a custom search service built on Meilisearch and integrated directly into the XENO workspace. When you ask a question that requires current information, the system:\n\n1. Identifies that the question needs web data\n2. Performs a real-time web search\n3. Retrieves and indexes the most relevant results\n4. Feeds the information to the AI model as context\n5. Returns an answer grounded in current data\n\n## Use cases\n\n- **Research** — get up-to-date information on any topic\n- **News** — ask about current events\n- **Technical docs** — find the latest API documentation\n- **Fact-checking** — verify claims with current sources\n\n## Privacy\n\nXENO Search runs on our own infrastructure. Your queries are not sent to third-party search engines in a way that identifies you. Results are cached locally for performance.',
  NULL,
  'update',
  ARRAY['search', 'web', 'meilisearch'],
  'XENO Team',
  true,
  '2026-03-22 10:00:00'
),

-- COMMUNITY post
(
  'building-with-xeno-api',
  'Building with the XENO API: How Developers Are Extending the Platform',
  'The XENO API powers everything from custom chatbots to automated content pipelines. Here is how the community is using it to build on top of XENO Studio.',
  E'# Building with the XENO API\n\nEverything you can do in the XENO Studio UI is backed by a REST API. Developers are using this API to build integrations, automations, and entirely new products.\n\n## What you can do\n\nThe API at xenostudio.ai/api provides endpoints for:\n- **Chat completions** — send messages to any supported AI model\n- **Image generation** — generate images programmatically\n- **File management** — upload, convert, and manage files\n- **Code execution** — run code in sandboxed containers\n- **Search** — query the web through XENO Search\n\n## Example: Automated Blog Writing Pipeline\n\nOne developer built a pipeline that:\n1. Monitors RSS feeds for topics in their niche\n2. Uses the chat API to generate draft blog posts\n3. Generates cover images with the image API\n4. Publishes to their CMS automatically\n\n## Example: Customer Support Bot\n\nA startup integrated the chat API into their support system:\n1. Customer messages are forwarded to the XENO API\n2. The AI responds based on the company''s documentation\n3. Complex issues are escalated to human agents\n4. All interactions are logged for quality review\n\n## Getting started\n\nCheck out the API reference at xenostudio.ai/docs/api. You will need an API key, which you can generate from your account settings.',
  NULL,
  'community',
  ARRAY['api', 'developers', 'integrations'],
  'XENO Team',
  true,
  '2026-03-15 10:00:00'
),

(
  'community-spotlight-creative-workflows',
  'Community Spotlight: Creative Workflows Built on XENO Studio',
  'From concept art pipelines to AI-assisted music production, here are some of the most creative ways our community is using XENO Studio.',
  E'# Community Spotlight: Creative Workflows\n\nOur community never stops surprising us. Here are some standout workflows people have built using XENO Studio.\n\n## Concept Art Pipeline\n\nA game studio uses XENO Studio as their concept art pipeline:\n1. **Brainstorm** in chat — describe the character or environment\n2. **Generate variations** — use image generation to explore visual directions\n3. **Refine** — use image-to-image to iterate on the best concepts\n4. **Document** — use Office Canvas to create style guides and spec sheets\n\n## Music Video Production\n\nAn independent musician uses XENO Studio for their entire music video process:\n1. **Storyboard** — chat with AI to develop the visual narrative\n2. **Frame generation** — create key frames with image generation\n3. **Video** — use video generation to bring frames to life\n4. **Edit** — assemble everything in the video editor\n\n## Research Assistant\n\nA graduate student uses XENO Studio as a research assistant:\n1. **Literature review** — use XENO Search to find papers\n2. **Summarize** — chat to extract key findings\n3. **Write** — draft sections in Office Canvas\n4. **Format** — export to LaTeX for submission\n\n## Share your workflow\n\nWe would love to feature your workflow. Reach out to us on social media or email hello@xenostudio.ai.',
  NULL,
  'community',
  ARRAY['community', 'workflows', 'creative'],
  'XENO Team',
  true,
  '2026-03-25 10:00:00'
)

ON CONFLICT (slug) DO NOTHING;
