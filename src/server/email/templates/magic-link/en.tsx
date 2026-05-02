/**
 * Magic-link — English.
 *
 * Magic-link login is deferred (CONTEXT.md §deferred). The template exists
 * now so future v1.1 enabling is a config change, not a content shipment.
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

export const subject = 'Your login link';

interface Props {
  loginUrl: string;
  expiresInMinutes: number;
}

export default function MagicLinkEn({ loginUrl, expiresInMinutes }: Props) {
  return (
    <Html lang="en">
      <Head />
      <Preview>Your login link for VTTL Topsport</Preview>
      <Body style={{ fontFamily: 'system-ui, sans-serif', lineHeight: 1.5, color: '#1a1a1a' }}>
        <Container>
          <Heading style={{ color: '#0066cc' }}>Your login link</Heading>
          <Text>
            Click the button below to sign in to VTTL Topsport. No password required.
          </Text>
          <Section style={{ margin: '24px 0' }}>
            <Link
              href={loginUrl}
              style={{
                background: '#0066cc',
                color: '#fff',
                padding: '12px 24px',
                textDecoration: 'none',
                borderRadius: 4,
                display: 'inline-block',
              }}
            >
              Sign in
            </Link>
          </Section>
          <Text style={{ color: '#666', fontSize: 14 }}>
            Or paste this link into your browser: {loginUrl}
          </Text>
          <Text style={{ color: '#666', fontSize: 14 }}>
            This link expires in {expiresInMinutes} minutes. If you did not request this,
            you can ignore this email.
          </Text>
          <Hr style={{ margin: '32px 0', border: 0, borderTop: '1px solid #eee' }} />
          <Text style={{ color: '#999', fontSize: 12 }}>
            VTTL — Flemish Table Tennis League · vttl.be
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
