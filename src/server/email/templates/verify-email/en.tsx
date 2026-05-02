/**
 * Verify-email — English.
 *
 * See nl.tsx header for rationale on subject literal duplication and why
 * email copy lives in template files, not in messages/*.json.
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

export const subject = 'Verify your email';

interface Props {
  verifyUrl: string;
}

export default function VerifyEmailEn({ verifyUrl }: Props) {
  return (
    <Html lang="en">
      <Head />
      <Preview>Verify your email address for VTTL Topsport</Preview>
      <Body style={{ fontFamily: 'system-ui, sans-serif', lineHeight: 1.5, color: '#1a1a1a' }}>
        <Container>
          <Heading style={{ color: '#0066cc' }}>Verify your email</Heading>
          <Text>
            Welcome to VTTL Topsport. Click the button below to verify your email
            address.
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
              Verify email
            </Link>
          </Section>
          <Text style={{ color: '#666', fontSize: 14 }}>
            Or paste this link into your browser: {verifyUrl}
          </Text>
          <Text style={{ color: '#666', fontSize: 14 }}>This link expires in 24 hours.</Text>
          <Hr style={{ margin: '32px 0', border: 0, borderTop: '1px solid #eee' }} />
          <Text style={{ color: '#999', fontSize: 12 }}>
            VTTL — Flemish Table Tennis League · vttl.be
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
