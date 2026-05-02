/**
 * Verify-email — Français.
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

export const subject = 'Confirmez votre adresse e-mail';

interface Props {
  verifyUrl: string;
}

export default function VerifyEmailFr({ verifyUrl }: Props) {
  return (
    <Html lang="fr">
      <Head />
      <Preview>Confirmez votre adresse e-mail pour VTTL Topsport</Preview>
      <Body style={{ fontFamily: 'system-ui, sans-serif', lineHeight: 1.5, color: '#1a1a1a' }}>
        <Container>
          <Heading style={{ color: '#0066cc' }}>Confirmez votre adresse e-mail</Heading>
          <Text>
            Bienvenue sur VTTL Topsport. Cliquez sur le bouton ci-dessous pour confirmer
            votre adresse e-mail.
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
              Confirmer l&apos;e-mail
            </Link>
          </Section>
          <Text style={{ color: '#666', fontSize: 14 }}>
            Ou copiez ce lien dans votre navigateur : {verifyUrl}
          </Text>
          <Text style={{ color: '#666', fontSize: 14 }}>
            Ce lien expire dans 24 heures.
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
