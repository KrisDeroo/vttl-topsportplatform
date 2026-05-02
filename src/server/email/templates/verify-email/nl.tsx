/**
 * Verify-email — Nederlands.
 *
 * Default-exported component renders the React Email body; named-export
 * `subject` mirrors the entry in `src/server/email/send.ts` SUBJECTS map so
 * the literal can be statically grepped (verify check + future audit).
 *
 * Subject + body strings live IN this file (not in `messages/*.json`) — see
 * .planning/phases/01-fundament/01-RESEARCH.md §Email Templates for the
 * rationale: non-engineers can edit emails per locale without touching the
 * i18n catalogue.
 */
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';

export const subject = 'Bevestig je e-mailadres';

interface Props {
  verifyUrl: string;
}

export default function VerifyEmailNl({ verifyUrl }: Props) {
  return (
    <Html lang="nl">
      <Head />
      <Preview>Bevestig je e-mailadres voor VTTL Topsport</Preview>
      <Body style={{ fontFamily: 'system-ui, sans-serif', lineHeight: 1.5, color: '#1a1a1a' }}>
        <Container>
          <Heading style={{ color: '#0066cc' }}>Bevestig je e-mailadres</Heading>
          <Text>
            Welkom bij VTTL Topsport. Klik op de knop hieronder om je e-mailadres te
            bevestigen.
          </Text>
          <Section style={{ margin: '24px 0' }}>
            <Link
              href={verifyUrl}
              style={{
                background: '#0066cc',
                color: '#fff',
                padding: '12px 24px',
                textDecoration: 'none',
                borderRadius: 4,
                display: 'inline-block',
              }}
            >
              Bevestig e-mail
            </Link>
          </Section>
          <Text style={{ color: '#666', fontSize: 14 }}>
            Of kopieer deze link in je browser: {verifyUrl}
          </Text>
          <Text style={{ color: '#666', fontSize: 14 }}>Deze link is 24 uur geldig.</Text>
          <Hr style={{ margin: '32px 0', border: 0, borderTop: '1px solid #eee' }} />
          <Text style={{ color: '#999', fontSize: 12 }}>
            VTTL — Vlaamse Tafeltennis Liga · vttl.be
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
