import React from 'react';
import { Link } from 'react-router-dom';
import MarketingPage, { Section, Prose, CheckList } from '../components/marketing/MarketingPage';

const Refunds: React.FC = () => (
  <MarketingPage
    eyebrow="LEGAL"
    title="Refund policy"
    subtitle="How refunds work for XENO subscriptions, credits, and marketplace purchases — written to be clear and fair, and to respect your statutory rights."
    updated="June 2026"
  >
    <Section title="Overview">
      <Prose
        blocks={[
          {
            p: (
              <>
                This policy explains when and how you can request a refund for purchases made through XENO
                Studio, including subscription plans, one-time credit purchases, and items bought in the
                XENO Marketplace. Our goal is to be fair and transparent. Nothing in this policy limits any
                non-waivable statutory rights you may have under the laws of your country or region. If a
                mandatory consumer-protection law gives you greater rights than this policy, that law
                applies.
              </>
            ),
          },
        ]}
      />
    </Section>

    <Section title="Details">
      <Prose
        blocks={[
          {
            h: 'Subscriptions',
            p: (
              <>
                You can cancel a subscription at any time from your account billing settings. When you
                cancel, you keep access to your paid plan until the end of the current billing period, and
                you will not be charged again. Because you retain full access for the period you paid for,
                we generally do not provide partial-month or prorated refunds for the unused portion of a
                billing cycle, except where required by law. If you were charged in error or experienced a
                billing problem, contact us and we will make it right.
              </>
            ),
          },
          {
            h: 'Credits',
            p: (
              <>
                Credits power AI generation and metered features across the platform. One-time credit
                purchases are generally non-refundable once the credits have been used, because the
                underlying compute and model costs are incurred at the time of use. If you have unused
                credits from a recent purchase, you may be eligible for a refund of the unused balance if
                you request it within 14 days of purchase. Promotional, bonus, or granted credits have no
                cash value and are not refundable.
              </>
            ),
          },
          {
            h: 'Marketplace purchases',
            p: (
              <>
                The XENO Marketplace offers digital goods such as apps, plugins, panels, models, agents
                (Minds), and other content from XENO and third-party creators. Because these are digital
                items that are delivered or made available immediately, refunds are handled on a per-item
                basis according to the listing terms and the nature of the product. If an item is faulty,
                materially not as described, or does not function as advertised, you are entitled to a
                remedy. Subscription and rental items in the marketplace follow the same cancellation
                approach as platform subscriptions above.
              </>
            ),
          },
          {
            h: 'How to request a refund',
            p: (
              <>
                To request a refund, email{' '}
                <a href="mailto:billing@xenostudio.ai" className="text-[#cdc7be] underline underline-offset-2 hover:text-[#ece7df]">
                  billing@xenostudio.ai
                </a>{' '}
                from the email address associated with your account. Please include the order or invoice
                reference, the date of purchase, the item or plan in question, and a brief description of
                the reason for your request. We aim to review every request promptly and will let you know
                the outcome. Approved refunds are issued to the original payment method and may take a few
                business days to appear depending on your bank or card provider.
              </>
            ),
          },
          {
            h: 'Chargebacks',
            p: (
              <>
                If you believe a charge is incorrect, please contact us first — most issues are resolved
                quickly and directly. Filing a chargeback or payment dispute without contacting us can lead
                to your account being temporarily suspended while the dispute is investigated, and may
                affect access to purchases and credits. We are always willing to work with you to find a
                fair resolution.
              </>
            ),
          },
          {
            h: 'EU / UK statutory rights',
            p: (
              <>
                If you are a consumer in the European Union, the United Kingdom, or another jurisdiction
                with a statutory right of withdrawal, you may have the right to cancel certain purchases
                within a set period (often 14 days). Please note that for digital content and services,
                this right may not apply once performance has begun with your express consent — for
                example, once you have started using purchased credits or downloaded a digital item. Where
                statutory rights apply, they take precedence over the general terms in this policy. See the{' '}<Link to="/withdrawal" className="text-white/80 underline underline-offset-2">withdrawal instructions</Link>{' '}for the full statutory text.</>
            ),
          },
          {
            h: 'Changes to this policy',
            p: (
              <>
                We may update this refund policy from time to time to reflect changes to our products,
                pricing, or legal requirements. When we make material changes, we will update the date at
                the top of this page and, where appropriate, notify you. Your continued use of XENO after
                an update means you accept the revised policy.
              </>
            ),
          },
        ]}
      />
    </Section>

    <Section title="At a glance">
      <CheckList
        items={[
          'Cancel subscriptions anytime — access continues until the end of the paid period',
          'No partial-month refunds on subscriptions except where required by law',
          'Used credits are non-refundable; unused credits may be eligible within 14 days',
          'Marketplace digital goods are handled per item and listing terms',
          'Faulty or materially misdescribed items are always eligible for a remedy',
          'Statutory consumer rights always take precedence over this policy',
        ]}
      />
    </Section>

    <Section title="Contact">
      <Prose
        blocks={[
          {
            p: (
              <>
                Questions about a charge or a refund? Reach our billing team at{' '}
                <a href="mailto:billing@xenostudio.ai" className="text-[#cdc7be] underline underline-offset-2 hover:text-[#ece7df]">
                  billing@xenostudio.ai
                </a>{' '}
                and we will be glad to help.
              </>
            ),
          },
        ]}
      />
    </Section>
  </MarketingPage>
);

export default Refunds;
