'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { AIGenerateButton } from '@/components/ui/ai-generate-button';
import { createTemplate } from '@/lib/api';
import { toast } from 'sonner';

export default function NewTemplatePage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState('');
  const [personaPrompt, setPersonaPrompt] = useState('');
  const [toneGuidance, setToneGuidance] = useState('');
  const [globalFollowupLimit, setGlobalFollowupLimit] = useState(3);
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(30);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const token = await getToken();
      if (!token) throw new Error('Not authenticated');

      const res = await createTemplate(
        {
          name,
          personaPrompt,
          toneGuidance: toneGuidance || undefined,
          globalFollowupLimit,
          timeLimitMinutes,
        },
        token
      );

      toast.success('Interview template created!');
      router.push(`/dashboard/templates/${res.data.id}`);
    } catch (error) {
      toast.error('Failed to create template');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-3xl">
      {/* Back link */}
      <Link
        href="/dashboard/settings"
        className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Settings
      </Link>

      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary">
          Create Interview Template
        </h1>
        <p className="text-text-secondary mt-1">
          Set up your AI interviewer persona and interview settings.
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">Interview Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Frontend Developer Interview"
                required
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="persona">AI Persona</Label>
                <AIGenerateButton
                  fieldType="persona"
                  currentValue={personaPrompt}
                  onGenerate={setPersonaPrompt}
                  context={name ? `Interview name: ${name}` : undefined}
                />
              </div>
              <Textarea
                id="persona"
                value={personaPrompt}
                onChange={(e) => setPersonaPrompt(e.target.value)}
                placeholder="Describe the interviewer's persona. e.g., You are Alex, a friendly senior engineer conducting a technical interview. You're genuinely curious about the candidate's experience and problem-solving approach."
                rows={4}
                required
              />
              <p className="text-xs text-text-muted">
                This defines the AI interviewer's personality and approach.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="tone">Tone Guidance (Optional)</Label>
                <AIGenerateButton
                  fieldType="tone"
                  currentValue={toneGuidance}
                  onGenerate={setToneGuidance}
                />
              </div>
              <Textarea
                id="tone"
                value={toneGuidance}
                onChange={(e) => setToneGuidance(e.target.value)}
                placeholder="e.g., Warm and encouraging, professional but conversational. Ask clarifying questions when answers are vague."
                rows={3}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Interview Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="followupLimit">Max Follow-ups per Question</Label>
                <Input
                  id="followupLimit"
                  type="number"
                  min={1}
                  max={10}
                  value={globalFollowupLimit}
                  onChange={(e) => setGlobalFollowupLimit(Number(e.target.value))}
                />
                <p className="text-xs text-text-muted">
                  How many follow-up questions before moving on.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="timeLimit">Time Limit (minutes)</Label>
                <Input
                  id="timeLimit"
                  type="number"
                  min={5}
                  max={120}
                  value={timeLimitMinutes}
                  onChange={(e) => setTimeLimitMinutes(Number(e.target.value))}
                />
                <p className="text-xs text-text-muted">
                  Maximum interview duration.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-4">
          <Link href="/dashboard/settings">
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </Link>
          <Button type="submit" disabled={loading || !name || !personaPrompt}>
            {loading ? 'Creating...' : 'Create Interview'}
          </Button>
        </div>
      </form>
    </div>
  );
}
