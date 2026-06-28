# Requirements Document

## Introduction

Video Generation Studio is a self-contained, client-side web application (HTML, CSS, JavaScript) that lets a user generate short cinematic video clips using third-party AI video generation providers through bring-your-own API keys. The application is provider-agnostic: the user pastes an API key, the application fetches the provider's available models, the user selects a text-to-video and/or image-to-video model, supplies a text prompt and/or reference images, configures generation options (aspect ratio, resolution, clip length), and generates video.

Because most providers cap a single clip at roughly 5 to 10 seconds, the application supports generating multiple segments and assembling them client-side into a longer advertisement (target 15 to 30 seconds). Because free tiers commonly restrict resolution and length, the application exposes the full set of options but disables or flags any option that the selected model or tier cannot satisfy. Because video generation is long-running and asynchronous, the application submits jobs, polls for status, indicates progress, and handles errors. The application runs entirely in the browser as a static site; API keys are stored client-side only and are never hardcoded or transmitted to any endpoint other than the user-selected provider.

## Glossary

- **Studio**: The client-side Video Generation Studio web application as a whole.
- **Provider**: A third-party AI service that exposes video generation models through an HTTP API (for example Hugging Face Inference Providers, PixVerse, Kling, Hailuo, Pika).
- **Provider_Adapter**: The Studio component that translates between the Studio's internal requests and a specific Provider's API format.
- **Key_Manager**: The Studio component responsible for accepting, storing, retrieving, and clearing API keys in browser local storage.
- **Model_Catalog**: The Studio component that fetches and presents the list of models available for a Provider and a supplied API key.
- **Model**: A single video generation capability offered by a Provider, with declared capabilities (text input support, image input support, supported resolutions, supported clip lengths, supported aspect ratios).
- **Prompt_Editor**: The Studio component that accepts the user's text prompt and reference images.
- **Generation_Options**: The user-configurable settings for a generation request: aspect ratio, resolution, and clip length.
- **Aspect_Ratio**: The frame shape of the output video, one of landscape 16:9, square 1:1, or portrait 9:16.
- **Resolution**: The output frame size, one of 720p, 1080p, 2K, or 4K.
- **Clip_Length**: The duration in seconds of a single generated segment, one of 5, 10, 15, or 20 seconds.
- **Segment**: A single generated video clip produced by one generation job.
- **Project**: An ordered collection of Segments that the user assembles into a single advertisement video.
- **Job**: A single asynchronous video generation request submitted to a Provider, identified by a job identifier and having a status.
- **Job_Manager**: The Studio component that submits Jobs, polls Job status, reports progress, and surfaces results or errors.
- **Assembler**: The Studio component that concatenates ordered Segments into a single output video file client-side.
- **Local_Storage**: The browser's persistent key-value storage available to the Studio origin.

## Requirements

### Requirement 1: API Key Entry and Storage

**User Story:** As a user, I want to paste and store my provider API key in the browser, so that I can authenticate generation requests without re-entering the key each session.

#### Acceptance Criteria

1. WHEN the user submits a non-empty API key of at most 4096 characters for a selected Provider, THE Key_Manager SHALL store the API key in Local_Storage associated with that Provider, replacing any API key previously stored for that Provider.
2. IF the user submits an empty API key or an API key exceeding 4096 characters, THEN THE Key_Manager SHALL reject the submission, retain any previously stored API key for that Provider unchanged, and display an error indicating that the API key is empty or too long.
3. IF storing the API key to Local_Storage fails because Local_Storage is unavailable or its quota is exceeded, THEN THE Key_Manager SHALL not persist the API key and SHALL display an error indicating that the API key could not be saved.
4. WHEN the Studio loads and a stored API key exists for a Provider, THE Key_Manager SHALL retrieve the stored API key for use in requests.
5. WHEN the user requests removal of a stored API key for a Provider, THE Key_Manager SHALL delete the API key from Local_Storage associated with that Provider.
6. WHILE an API key is displayed in an input field, THE Studio SHALL mask every character of the API key by default.
7. WHEN the user activates the reveal control for an API key input field, THE Studio SHALL display the unmasked API key characters until the reveal control is deactivated.
8. THE Studio SHALL transmit the API key only to the user-selected Provider endpoint.
9. THE Studio SHALL display a notice that API keys are stored in the browser Local_Storage and are accessible to scripts running on the Studio origin.

### Requirement 2: Provider Selection

**User Story:** As a user, I want to choose which provider to use, so that I can work with a service for which I hold an API key.

#### Acceptance Criteria

1. WHEN the Studio loads the provider selection interface, THE Studio SHALL display the complete list of supported Providers from which the user can select exactly one Provider at a time.
2. WHEN the user selects a Provider for which an API key is stored on the client device, THE Studio SHALL load that stored API key and SHALL display an indication that the selected Provider is ready for use.
3. WHEN the user selects a Provider for which no API key is stored on the client device, THE Studio SHALL display an input prompt requesting the user to enter an API key for that Provider.
4. WHEN the user enters an API key for the selected Provider, THE Studio SHALL store the API key in association with that Provider on the client device for use in the current session and subsequent sessions.
5. WHEN the Studio loads the provider selection interface and a Provider was selected in a previous session, THE Studio SHALL restore that previously selected Provider as the active selection.
6. IF no Provider is currently selected, THEN THE Studio SHALL disable video generation actions and SHALL display a message indicating that a Provider must be selected before proceeding.

### Requirement 3: Model Catalog Retrieval

**User Story:** As a user, I want to fetch the list of available models from my provider, so that I can pick a model that fits my needs.

#### Acceptance Criteria

1. WHEN the user requests the model list for a selected Provider with a stored API key, THE Model_Catalog SHALL request the available Models from the Provider through the Provider_Adapter within a request timeout of 30 seconds.
2. IF the user requests the model list when no Provider is selected or no API key is stored for the selected Provider, THEN THE Model_Catalog SHALL display a message indicating that a Provider and API key are required and SHALL NOT send a request through the Provider_Adapter.
3. WHEN the Provider returns a list of one or more Models, THE Model_Catalog SHALL display each Model with its declared capabilities for text input, image input, supported resolutions, supported clip lengths, and supported aspect ratios.
4. WHEN the Provider returns a Model for which one or more of the capabilities (text input, image input, supported resolutions, supported clip lengths, supported aspect ratios) are not declared, THE Model_Catalog SHALL display that Model and indicate each undeclared capability as unspecified.
5. WHEN the Provider returns an empty list of Models, THE Model_Catalog SHALL display a message indicating that no Models are available for the selected Provider.
6. IF the Provider returns an authentication error, THEN THE Model_Catalog SHALL display a message indicating the API key was rejected and SHALL offer a retry action.
7. IF the model list request fails due to a network error, a Provider error, or the 30-second request timeout being exceeded, THEN THE Model_Catalog SHALL display an error message identifying the failure cause and SHALL offer a retry action.
8. WHILE the model list request is in progress, THE Model_Catalog SHALL display a loading indicator.

### Requirement 4: Model Selection

**User Story:** As a user, I want to select a video generation model, so that I can generate video from text and/or images.

#### Acceptance Criteria

1. THE Studio SHALL allow the user to select exactly one Model from the displayed Model_Catalog, and no Model SHALL be selected by default.
2. WHEN the user selects a Model, THE Studio SHALL enable only the input types that the selected Model declares as supported and disable all unsupported input types.
3. WHERE the selected Model supports text input, THE Prompt_Editor SHALL accept a text prompt of 1 to 5000 characters.
4. WHERE the selected Model supports image input, THE Prompt_Editor SHALL accept between 1 and 10 reference images, each up to 20 MB.
5. IF the user changes the selected Model, THEN THE Studio SHALL update the available Generation_Options to match the newly selected Model's declared capabilities within 1 second.
6. WHEN the user changes the selected Model, IF previously entered inputs are of an input type not supported by the newly selected Model, THEN THE Studio SHALL remove those incompatible inputs and display a notification indicating which inputs were removed.
7. IF the Model_Catalog contains no available Model, THEN THE Studio SHALL disable Model selection and display a message indicating that no Model is available.

### Requirement 5: Prompt and Reference Image Input

**User Story:** As a user, I want to paste a text prompt and provide reference images, so that I can direct the content and style of the generated video.

#### Acceptance Criteria

1. WHERE the selected Model supports text input, THE Prompt_Editor SHALL accept a text prompt of up to 5,000 characters entered by the user.
2. WHERE the selected Model supports image input, THE Prompt_Editor SHALL accept reference images in JPEG, PNG, and WebP formats, each up to 10 MB in size, by file upload and by paste, up to a maximum of 4 reference images.
3. IF the user attempts to add a reference image whose format is not JPEG, PNG, or WebP, or whose size exceeds 10 MB, or that would exceed the maximum of 4 reference images, THEN THE Prompt_Editor SHALL reject the image, SHALL display a message indicating the reason for rejection, and SHALL retain any previously added reference images.
4. WHEN the user adds a reference image, THE Prompt_Editor SHALL display a thumbnail preview of the added image within 2 seconds.
5. WHEN the user removes a reference image, THE Prompt_Editor SHALL remove the image from the generation inputs and SHALL remove its preview.
6. IF the user attempts to generate without providing any input that the selected Model requires, THEN THE Studio SHALL display a message identifying each required input that is missing and SHALL withhold the generation request, preserving any input already entered.

### Requirement 6: Generation Options Configuration

**User Story:** As a user, I want to set aspect ratio, resolution, and clip length, so that I can match the output to my advertisement format.

#### Acceptance Criteria

1. THE Studio SHALL offer Aspect_Ratio choices of landscape 16:9, square 1:1, and portrait 9:16.
2. THE Studio SHALL offer Resolution choices of 720p, 1080p, 2K, and 4K.
3. THE Studio SHALL offer Clip_Length choices of 5, 10, 15, and 20 seconds.
4. WHEN the user selects a Model, THE Studio SHALL set the default Aspect_Ratio, Resolution, and Clip_Length to values that the selected Model supports.
5. WHERE the selected Model does not support a given Aspect_Ratio, Resolution, or Clip_Length value, THE Studio SHALL disable that value in the Generation_Options.
6. WHEN the user changes the selected Model and a currently selected Generation_Options value is not supported by the newly selected Model, THE Studio SHALL replace that value with a supported value within 1 second.
7. WHEN the user selects an Aspect_Ratio, Resolution, and Clip_Length supported by the selected Model, THE Studio SHALL apply the selected values to the generation request.
8. IF the user selects a combination of Generation_Options that the selected Model cannot satisfy, THEN THE Studio SHALL display a message identifying the unsupported value, SHALL withhold the generation request, and SHALL retain the user's prior valid selections.

### Requirement 7: Video Generation Job Submission and Tracking

**User Story:** As a user, I want to generate a video and see its progress, so that I know when my clip is ready and can respond to failures.

#### Acceptance Criteria

1. WHEN the user starts generation with valid inputs and Generation_Options, THE Job_Manager SHALL submit a Job to the selected Provider through the Provider_Adapter and SHALL set the Job status to a non-terminal "submitted" state.
2. IF the user starts generation while a required input is missing or invalid, or while no API key is configured for the selected Provider, THEN THE Job_Manager SHALL reject the submission, SHALL NOT create a Job, and SHALL display an error message indicating which input or configuration is missing or invalid.
3. WHILE a Job has not reached a terminal status, THE Job_Manager SHALL poll the Provider for the Job status at a configurable interval that defaults to 5 seconds and is bounded between 1 second and 60 seconds.
4. WHILE a Job is in progress, THE Studio SHALL display a progress indication for the Job that updates after each poll and shows at minimum the current Job status and elapsed time since submission.
5. WHEN a Job reaches a successful terminal status, THE Job_Manager SHALL retrieve the resulting Segment and SHALL display a preview of the Segment within the Studio.
6. IF a Job returns a failure status, THEN THE Job_Manager SHALL stop polling that Job, SHALL display the failure reason reported by the Provider, and SHALL offer a retry action that resubmits the Job with the original inputs and Generation_Options.
7. IF a Job remains in a non-terminal status longer than a configurable polling timeout that defaults to 300 seconds and is bounded between 30 seconds and 1800 seconds, THEN THE Job_Manager SHALL stop polling that Job, SHALL display a timeout message, and SHALL offer a retry action.
8. WHEN the user cancels an in-progress Job, THE Job_Manager SHALL stop polling that Job and SHALL set the Job status to a terminal "cancelled" state.

### Requirement 8: Multi-Segment Generation and Assembly

**User Story:** As a user, I want to generate multiple segments and stitch them into one video, so that I can produce a 15 to 30 second advertisement despite per-clip length limits.

#### Acceptance Criteria

1. THE Studio SHALL allow the user to add Segments to a Project up to a maximum of 20 Segments per Project.
2. WHEN a Job completes successfully, THE Studio SHALL append the resulting Segment to the end of the current Project's ordered Segment list.
3. THE Studio SHALL allow the user to reorder Segments within a Project, preserving the new order for subsequent assembly.
4. THE Studio SHALL allow the user to remove a Segment from a Project, leaving the remaining Segments in their relative order.
5. WHEN the user requests assembly of a Project containing two or more Segments, THE Assembler SHALL concatenate the Segments in their Project order into a single output video client-side.
6. IF the user requests assembly of a Project containing fewer than two Segments, THEN THE Assembler SHALL not start concatenation and THE Studio SHALL display a message indicating that at least two Segments are required.
7. WHEN the Assembler completes concatenation, THE Studio SHALL provide the assembled output video for download.
8. IF the Segments in a Project have differing Resolution or Aspect_Ratio values, THEN THE Assembler SHALL display a message identifying the mismatched values and SHALL not proceed with concatenation until the user explicitly confirms.
9. IF concatenation fails before producing an output video, THEN THE Assembler SHALL stop the assembly, THE Studio SHALL display an error message indicating that assembly failed, and THE Studio SHALL retain all Segments in the Project unchanged.

### Requirement 9: Output Preview and Download

**User Story:** As a user, I want to preview and download my generated segments and assembled video, so that I can review and use them outside the Studio.

#### Acceptance Criteria

1. WHEN a Segment is available, THE Studio SHALL display the Segment in a video preview with playback controls for play, pause, and seek.
2. WHEN a Segment is available, THE Studio SHALL provide a download action that saves the Segment as a video file to the user's device.
3. WHEN an assembled Project video is available, THE Studio SHALL provide a download action that saves the assembled video as a single video file to the user's device.
4. WHEN the user activates a download action, THE Studio SHALL begin the download within 2 seconds and display a visible indication that the download has started.
5. IF a Segment or assembled Project video is unavailable, incomplete, or fails to load, THEN THE Studio SHALL disable the corresponding preview and download actions and display an error message indicating that the output is not available.
6. IF a download action fails to start, THEN THE Studio SHALL retain the available output and display an error message indicating the download could not be completed.

### Requirement 10: Client-Side Static Application

**User Story:** As a user, I want the application to run as a static client-side site, so that I can use it without operating a backend server.

#### Acceptance Criteria

1. THE Studio SHALL execute all application logic using only HTML, CSS, and client-side JavaScript that runs in the user's browser.
2. THE Studio SHALL load and operate all features when its files are served as static assets without any Studio-operated backend server.
3. THE Studio SHALL exclude API keys from all of its source, configuration, and build-output files.
4. WHEN a user provides an API key at runtime, THE Studio SHALL retain that key only within client-side storage on the user's device and SHALL NOT transmit it to any Studio-operated server.
5. WHEN the Studio sends a request that includes a user-provided API key, THE Studio SHALL send that request only to the corresponding AI provider's endpoint.
6. IF no API key is available for a requested provider operation, THEN THE Studio SHALL reject the operation and SHALL display an error message indicating that a provider API key is required, while preserving any user-entered input.
