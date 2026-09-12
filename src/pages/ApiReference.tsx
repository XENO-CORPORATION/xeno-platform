import React from 'react';
import MarketingPage, { Section, Prose, FeatureGrid, CTA } from '../components/marketing/MarketingPage';

const ApiReference: React.FC = () => (
  <MarketingPage
    eyebrow="DEVELOPERS"
    title="XENO API"
    subtitle="Build on XENO over a single REST API — image, video, and audio generation, OpenAI-compatible chat, agents, and credit-metered usage, all behind one bearer key."
    updated="June 2026"
  >
    <Section title="Base URL">
      <Prose
        blocks={[
          {
            p: (
              <>
                All API requests are made over HTTPS to the versioned base URL below. Every endpoint in
                this reference is relative to it.
              </>
            ),
          },
        ]}
      />
      <pre className="mt-5 overflow-x-auto rounded-[10px] border border-white/[0.07] bg-[#0a0a0c] p-4 font-mono text-[12.5px] text-[#cdc7be]">
        https://api.xenostudio.ai/v1
      </pre>
    </Section>

    <Section title="Authentication">
      <Prose
        blocks={[
          {
            p: (
              <>
                The XENO API authenticates with a bearer API key. Create and rotate keys from your
                account Settings, then send the key in the <code className="text-[#cdc7be]">Authorization</code>{' '}
                header on every request. Keep keys server-side — never ship them in client code.
              </>
            ),
          },
        ]}
      />
      <pre className="mt-5 overflow-x-auto rounded-[10px] border border-white/[0.07] bg-[#0a0a0c] p-4 font-mono text-[12.5px] text-[#cdc7be]">
{`curl https://api.xenostudio.ai/v1/images \\
  -H "Authorization: Bearer $XENO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "xeno-image-1",
    "prompt": "a neon-lit city skyline at dusk",
    "size": "1024x1024"
  }'`}
      </pre>
    </Section>

    <Section title="Endpoints">
      <FeatureGrid
        items={[
          {
            title: 'POST /v1/images',
            desc: 'Generate and edit images from text prompts and reference inputs. Returns rendered assets and the credits charged.',
          },
          {
            title: 'POST /v1/video',
            desc: 'Generate video clips from prompts or stills. Long jobs return a job id you poll until the render completes.',
          },
          {
            title: 'POST /v1/audio',
            desc: 'Text-to-speech, transcription, and audio generation. Returns audio assets or a transcript payload.',
          },
          {
            title: 'POST /v1/chat/completions',
            desc: 'OpenAI-compatible chat completions backed by XENO models. Drop-in for existing SDKs by swapping the base URL and key.',
          },
          {
            title: 'GET /v1/credits',
            desc: 'Read your current credit balance and recent usage so you can meter and budget calls before you make them.',
          },
          {
            title: 'GET /v1/models',
            desc: 'List the models available to your account — image, video, audio, and chat — with their ids and capabilities.',
          },
        ]}
      />
    </Section>

    <Section title="Credits & rate limits">
      <Prose
        blocks={[
          {
            h: 'Usage is metered in credits',
            p: (
              <>
                Every generation and inference call draws from your workspace credit balance — the same
                balance the apps and Hub use. The cost depends on the model and the size of the job, and
                each response reports the credits charged. Check{' '}
                <code className="text-[#cdc7be]">GET /v1/credits</code> to track your balance, and top up
                from Billing before a large batch.
              </>
            ),
          },
          {
            h: 'Rate limits',
            p: (
              <>
                Requests are rate-limited per API key. When you exceed a limit the API responds with{' '}
                <code className="text-[#cdc7be]">429 Too Many Requests</code> and a{' '}
                <code className="text-[#cdc7be]">Retry-After</code> header — back off and retry with
                exponential delay. Need higher throughput? Contact us to raise your limits.
              </>
            ),
          },
        ]}
      />
    </Section>

    <CTA
      href="/signup"
      label="Get an API key"
      title="Ready to build?"
      desc="Create your account, grab a key from Settings, and make your first call in minutes."
    />
  </MarketingPage>
);

export default ApiReference;
