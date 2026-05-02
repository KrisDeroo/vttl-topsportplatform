/**
 * Password-reset — Nederlands.
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

export const subject = 'Stel je wachtwoord opnieuw in';

interface Props {
  resetUrl: string;
  expiresInMinutes: number;
}

export default function PasswordResetNl({ resetUrl, expiresInMinutes }: Props) {
  return (
    <Html lang="nl">
      <Head />
      <Preview>Stel je wachtwoord opnieuw in voor VTTL Topsport</Preview>
      <Body style={{ fontFamily: 'system-ui, sans-serif', lineHeight: 1.5, color: '#1a1a1a' }}>
        <Container>
          <Heading style={{ color: '#0066cc' }}>Stel je wachtwoord opnieuw in</Heading>
          <Text>
            We ontvingen een verzoek om je wachtwoord opnieuw in te stellen. Klik op de
            knop hieronder om een nieuw wachtwoord te kiezen.
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
              Wachtwoord opnieuw instellen
            </Link>
          </Section>
          <Text style={{ color: '#666', fontSize: 14 }}>
            Of kopieer deze link in je browser: {resetUrl}
          </Text>
          <Text style={{ color: '#666', fontSize: 14 }}>
            Deze link is {expiresInMinutes} minuten geldig. Als je dit verzoek niet hebt
            gedaan, kun je deze e-mail negeren.
          </Text>
          <Hr style={{ margin: '32px 0', border: 0, borderTop: '1px solid #eee' }} />
          <Text style={{ color: '#999', fontSize: 12 }}>
            VTTL — Vlaamse Tafeltennis Liga · vttl.be
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
