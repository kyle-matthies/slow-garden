"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { GardenData, Entry, ActionResult } from "@/lib/garden/types";
import {
  clearLegacySessionDrafts,
  DRAFTS_CLEARED_EVENT,
  openDraftStore,
} from "@/lib/garden/drafts";
