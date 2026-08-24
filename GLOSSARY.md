# Glossary

## Repository

Plain meaning: The complete project folder, together with the recorded history of its changes.

Technical meaning: A Git-managed collection of files, commits, branches, and configuration.

## Git

Plain meaning: The system that records every saved intervention made to the project and lets us compare or restore versions.

Technical meaning: A distributed version-control system that stores project history as commits and references.

## Local

Plain meaning: The copy of the project stored on this computer.

Technical meaning: The working tree and Git repository available on the user's machine.

## Remote

Plain meaning: Another copy of the project stored elsewhere, in this case on GitHub.

Technical meaning: A named reference to another Git repository, such as `origin`.

## GitHub

Plain meaning: The online service holding the shared copy of the project.

Technical meaning: A hosted platform for Git repositories, collaboration, reviews, and automation.

## Branch

Plain meaning: A named line of project history where work can continue without immediately changing another line.

Technical meaning: A movable Git reference pointing to a commit.

## main

Plain meaning: The project's primary line of recorded work.

Technical meaning: The default branch conventionally used as the main integration branch.

## Commit

Plain meaning: A recorded checkpoint describing a specific set of project changes.

Technical meaning: An immutable Git object containing a project snapshot, metadata, and parent reference or references.

## Fetch

Plain meaning: Ask GitHub what has changed and download that history, without replacing the files currently open on this computer.

Technical meaning: Download objects and references from a remote repository and update remote-tracking references without integrating them into the current branch.

## Pull

Plain meaning: Download the newer history and then apply it to the current local line of work.

Technical meaning: Run a fetch and then integrate the configured upstream branch into the current branch.

## Fast-forward

Plain meaning: Move the local history pointer forward because the online history continues directly from it, without combining two competing versions.

Technical meaning: Update a branch reference to a descendant commit without creating a merge commit.

## Untracked file

Plain meaning: A file present in the project folder that Git has not been instructed to include in its recorded history.

Technical meaning: A working-tree file that is absent from Git's index and current commit.

## Empty state

Plain meaning: The interface shown before an area contains any user-created content, explaining how to begin.

Technical meaning: A conditional UI state rendered when a collection, here the conversation messages, has no items.

## Suggested prompt

Plain meaning: A ready-made starting sentence that helps the user ask for a task without removing their ability to edit it.

Technical meaning: User-interface text inserted into a model-input composer but not submitted until the user explicitly sends it.

## Trade-off

Plain meaning: The cost accepted in exchange for an advantage; here, one extra action in exchange for control over the submitted prompt.

Technical meaning: The explicit balance between competing qualities of an engineering decision.

## Carousel

Plain meaning: A space that displays one item from a small set and lets the user move to the previous or next item.

Technical meaning: A composite interface widget that controls which slide is visible and exposes accessible navigation and position information.

## Mock data

Plain meaning: Temporary example content used to verify an interface before real content is connected.

Technical meaning: Deterministic development-only data that exercises a component's supported states without depending on a production data source.

## Reduced motion

Plain meaning: A user preference asking interfaces to reduce or remove non-essential movement.

Technical meaning: The `prefers-reduced-motion` media feature, which applications use to replace animated transitions with static state changes.

## localStorage

Plain meaning: A small browser-owned shelf that keeps simple values after a page refresh or browser restart.

Technical meaning: A synchronous, origin-scoped Web Storage API for persistent string key-value pairs.

## Timer

Plain meaning: A delayed instruction: wait for a chosen amount of time, then perform an action unless it is cancelled first.

Technical meaning: A scheduled callback created here with `window.setTimeout` and cancelled with `window.clearTimeout`.

## Layout shift

Plain meaning: A visible jump in which part of the interface changes size or position without the user asking it to.

Technical meaning: A change to rendered geometry that moves or resizes content between frames.

## Container query unit

Plain meaning: A CSS measurement based on the size of a chosen parent container rather than the changing size of the screen or an animated element.

Technical meaning: A relative CSS length such as `cqw`, where `1cqw` equals one percent of an eligible query container's width.
## Agent hub

**English term:** Agent hub

**Plain meaning:** One place from which a user can create agents, see agents they already have, or discover agents made by other people.

**Romanian gloss:** Centrul din care utilizatorul creează, gestionează și descoperă agenți.

## Mode tab

**English term:** Mode tab

**Plain meaning:** A selectable control that changes how the same interface handles the user's next request.

**Romanian gloss:** Un tab care schimbă modul de lucru al aceleiași interfețe.

## Mock button

**English term:** Mock button

**Plain meaning:** A temporary visual control used to test a design before its real destination or backend action exists.

**Romanian gloss:** Un buton temporar pentru verificarea designului, încă neconectat la funcția finală.

## Box shadow

**English term:** Box shadow

**Plain meaning:** One or more soft or crisp layers drawn around a container to show its edge and visual depth.

**Romanian gloss:** Unul sau mai multe straturi desenate în jurul unui container pentru a-i defini marginea și adâncimea vizuală.

## Inset shadow

**English term:** Inset shadow

**Plain meaning:** A shadow drawn inside a container, used here as a subtle inner edge rather than as an outside floating effect.

**Romanian gloss:** O umbră desenată în interiorul containerului, folosită aici ca margine discretă, nu ca efect exterior de plutire.

## Portal

**English term:** Portal

**Plain meaning:** Render a piece of UI in a different place in the page DOM (often `document.body`) so it is not clipped by a parent with `overflow: hidden`. Theme styles from the parent do not travel with it unless you re-apply them on the portal root.

**Romanian gloss:** Randăm o bucată de UI într-alt loc din DOM (deseori pe `body`) ca să nu fie tăiată de un părinte cu overflow. Culorile temei nu „călătoresc” automat — trebuie reaplicate pe rădăcina portalului.
