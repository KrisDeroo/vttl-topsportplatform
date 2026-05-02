/**
 * Password-reset — Français.
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

export const subject = 'Réinitialisez votre mot de passe';

interface Props {
  resetUrl: string;
  expiresInMinutes: number;
}

export default function PasswordResetFr({ resetUrl, expiresInMinutes }: Props) {
  return (
    <Html lang="fr">
      <Head />
      <Preview>Réinitialisez votre mot de passe pour VTTL Topsport</Preview>
      <Body style={{ fontFamily: 'system-ui, sans-serif', lineHeight: 1.5, color: '#1a1a1a' }}>
        <Container>
          <Heading style={{ color: '#0066cc' }}>Réinitialisez votre mot de passe</Heading>
          <Text>
            Nous avons reçu une demande de réinitialisation de votre mot de passe.
            Cliquez sur le bouton ci-dessous pour en choisir un nouveau.
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
              Réinitialiser le mot de passe
            </Link>
          </Section>
          <Text style={{ color: '#666', fontSize: 14 }}>
            Ou copiez ce lien dans votre navigateur : {resetUrl}
          </Text>
          <Text style={{ color: '#666', fontSize: 14 }}>
            Ce lien expire dans {expiresInMinutes} minutes. Si vous n&apos;êtes pas à
            l&apos;origine de cette demande, vous pouvez ignorer cet e-mail.
          </Text>
          <Hr style={{ margin: '32px 0', border: 0, borderTop: '1px solid #eee' }} />
          <Text style={{ color: '#999', fontSize: 12 }}>
            VTTL — Ligue Flamande de Tennis de Table · vttl.be
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
