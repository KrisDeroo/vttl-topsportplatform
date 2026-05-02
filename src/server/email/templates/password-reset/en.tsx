/**
 * Password-reset — English.
 *
 * Triggered by Better Auth `sendResetPassword` hook. SEC-05 sets
 * resetPasswordTokenExpiresIn = 60 minutes; copy mirrors that figure.
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

export const subject = 'Reset your password';

interface Props {
  resetUrl: string;
  expiresInMinutes: number;
}

export default function PasswordResetEn({ resetUrl, expiresInMinutes }: Props) {
  return (
    <Html lang="en">
      <Head />
      <Preview>Reset your password for VTTL Topsport</Preview>
      <Body style={{ fontFamily: 'system-ui, sans-serif', lineHeight: 1.5, color: '#1a1a1a' }}>
        <Container>
          <Heading style={{ color: '#0066cc' }}>Reset your password</Heading>
          <Text>
            We received a request to reset your password. Click the button below to
            choose a new one.
          </Text>
          <Section style={{ margin: '24px 0' }}>
            <Link
              href={resetUrl}
              style={{
                background: '#0066cc',
                color: '#fff',
                padding: '12px 24px',
                textDecoration: 'none',
                borderRadius: 4,
                display: 'inline-block',
              }}
            >
              Reset password
            </Link>
          </Section>
          <Text style={{ color: '#666', fontSize: 14 }}>
            Or paste this link into your browser: {resetUrl}
          </Text>
          <Text style={{ color: '#666', fontSize: 14 }}>
            This link expires in {expiresInMinutes} minutes. If you did not request a
            password reset, you can ignore this email.
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
