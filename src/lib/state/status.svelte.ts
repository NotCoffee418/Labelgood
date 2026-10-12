// The message shown above the output buttons
class Status {
  message = $state<{ text: string; error: boolean } | null>(null);
}

export const status = new Status();
