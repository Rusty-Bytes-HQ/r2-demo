import {
	type ActionFunctionArgs,
	json,
	type LoaderFunctionArgs,
} from "@remix-run/cloudflare";
import {
	Form,
	useActionData,
	useFetcher,
	useLoaderData,
} from "@remix-run/react";
import { useState, useRef, useEffect } from "react";

type Image = {
	id: number;
	url: string;
	name: string;
	description: string | null;
	created_at: string;
};

export async function loader({ context }: LoaderFunctionArgs) {
	try {
		const { DB } = context.cloudflare.env;

		const { results } = await DB.prepare(
			"SELECT * FROM images ORDER BY created_at DESC"
		).all<Image>();

		return json({
			status: "success" as const,
			images: results,
		});
	} catch (error) {
		console.error("Failed to load images:", error);
		return json({
			status: "error" as const,
			images: [] as Image[],
			message:
				error instanceof Error
					? error.message
					: "Failed to load images",
		});
	}
}

export async function action({ request, context }: ActionFunctionArgs) {
	try {
		const formData = await request.formData();
		const image = formData.get("image") as File;

		const { R2, DB } = context.cloudflare.env;
		let key: string | undefined;

		try {
			// Upload image to R2
			key = `images/${Date.now()}-${image.name.replace(/\s+/g, "-")}`;

			await R2.put(key, image, {
				httpMetadata: {
					contentType: image.type,
				},
			});

			// Get the public URL for the image
			const url = `${context.cloudflare.env.R2_PUBLIC_URL}/${key}`;

			console.log("url", url);

			const { AI } = context.cloudflare.env;

			const imageResponse = await fetch(url);
			if (!imageResponse.ok) {
				throw new Error(
					`Failed to fetch uploaded image: ${imageResponse.statusText}`
				);
			}
			const imageBlob = await imageResponse.arrayBuffer();

			let description;
			try {
				const response = await AI.run("@cf/unum/uform-gen2-qwen-500m", {
					prompt: "Describe this image",
					image: [...new Uint8Array(imageBlob)],
				});
				description = response.description;
			} catch (aiError) {
				console.error("AI description failed:", aiError);
				description = "Description unavailable";
			}

			// Store image details in D1
			const { success } = await DB.prepare(
				"INSERT INTO images (url, name, description) VALUES (?, ?, ?)"
			)
				.bind(url, image.name, description)
				.run();

			if (!success) {
				throw new Error("Failed to save image details to database");
			}

			return json({ success: true });
		} catch (error) {
			// If there's an error, try to delete the uploaded image from R2
			console.log("error", error);
			if (key) {
				try {
					await R2.delete(key);
				} catch (deleteError) {
					console.error(
						"Failed to delete image after error:",
						deleteError
					);
				}
			}
			throw error;
		}
	} catch (error) {
		console.error("Upload error:", error);
		return json(
			{
				error:
					error instanceof Error
						? error.message
						: "An unexpected error occurred",
			},
			{ status: 500 }
		);
	}
}

type ActionData = { success: true } | { error: string };

const isErrorResponse = (data: ActionData): data is { error: string } => {
	return "error" in data;
};

export default function Images() {
	const data = useLoaderData<typeof loader>();
	const actionData = useActionData<ActionData>();
	const [isDragging, setIsDragging] = useState(false);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const fetcher = useFetcher();
	const [image, setImage] = useState<File | null>(null);

	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (file) {
			const url = URL.createObjectURL(file);
			setPreviewUrl(url);
			setImage(file);
		}
	};

	const handleDrop = (e: React.DragEvent<HTMLFormElement>) => {
		e.preventDefault();
		setIsDragging(false);
		const file = e.dataTransfer.files?.[0];
		if (file && file.type.startsWith("image/")) {
			const url = URL.createObjectURL(file);
			setPreviewUrl(url);
			if (fileInputRef.current) {
				const dataTransfer = new DataTransfer();
				dataTransfer.items.add(file);
				fileInputRef.current.files = dataTransfer.files;
			}
		}
	};

	// Cleanup preview URL when component unmounts
	useEffect(() => {
		return () => {
			if (previewUrl) {
				URL.revokeObjectURL(previewUrl);
			}
		};
	}, [previewUrl]);

	return (
		<div className="min-h-screen bg-gray-100 p-8 dark:bg-gray-900">
			<div className="mx-auto max-w-6xl">
				<h1 className="mb-8 text-3xl font-bold text-gray-900 dark:text-white">
					Image Gallery
				</h1>

				{/* Loader Error Message */}
				{data.status === "error" && (
					<div className="mb-4 rounded-md bg-red-50 p-4 dark:bg-red-900/20">
						<div className="flex">
							<div className="flex-shrink-0">
								<svg
									className="h-5 w-5 text-red-400"
									viewBox="0 0 20 20"
									fill="currentColor"
								>
									<path
										fillRule="evenodd"
										d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
										clipRule="evenodd"
									/>
								</svg>
							</div>
							<div className="ml-3">
								<p className="text-sm font-medium text-red-800 dark:text-red-200">
									{data.message}
								</p>
							</div>
						</div>
					</div>
				)}

				{/* Error Message */}
				{actionData && isErrorResponse(actionData) && (
					<div className="mb-4 rounded-md bg-red-50 p-4 dark:bg-red-900/20">
						<div className="flex">
							<div className="flex-shrink-0">
								<svg
									className="h-5 w-5 text-red-400"
									viewBox="0 0 20 20"
									fill="currentColor"
								>
									<path
										fillRule="evenodd"
										d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
										clipRule="evenodd"
									/>
								</svg>
							</div>
							<div className="ml-3">
								<p className="text-sm font-medium text-red-800 dark:text-red-200">
									{actionData.error}
								</p>
							</div>
						</div>
					</div>
				)}

				{/* Success Message */}
				{actionData && !isErrorResponse(actionData) && (
					<div className="mb-4 rounded-md bg-green-50 p-4 dark:bg-green-900/20">
						<div className="flex">
							<div className="flex-shrink-0">
								<svg
									className="h-5 w-5 text-green-400"
									viewBox="0 0 20 20"
									fill="currentColor"
								>
									<path
										fillRule="evenodd"
										d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
										clipRule="evenodd"
									/>
								</svg>
							</div>
							<div className="ml-3">
								<p className="text-sm font-medium text-green-800 dark:text-green-200">
									Image uploaded successfully!
								</p>
							</div>
						</div>
					</div>
				)}

				{/* Upload Section */}
				<Form
					encType="multipart/form-data"
					onSubmit={(e) => {
						e.preventDefault();
						const formData = new FormData();
						if (image) {
							formData.append("image", image);
						}
						fetcher.submit(formData, {
							method: "post",
							action: "/images",
							encType: "multipart/form-data",
						});
					}}
					className="mb-8"
					onDragOver={(e) => {
						e.preventDefault();
						setIsDragging(true);
					}}
					onDragLeave={() => setIsDragging(false)}
					onDrop={handleDrop}
				>
					<div
						className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors ${
							isDragging
								? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/20"
								: "border-gray-300 dark:border-gray-700"
						}`}
					>
						{previewUrl ? (
							<div className="mb-4 w-full max-w-md">
								<img
									src={previewUrl}
									alt="Preview"
									className="mx-auto h-48 w-full rounded-lg object-cover"
								/>
								<button
									type="button"
									onClick={() => {
										setPreviewUrl(null);
										if (fileInputRef.current) {
											fileInputRef.current.value = "";
										}
									}}
									className="mt-2 w-full rounded-md bg-red-500 px-4 py-2 text-white hover:bg-red-600"
								>
									Remove
								</button>
							</div>
						) : (
							<div className="mb-4 text-center">
								<p className="text-lg text-gray-600 dark:text-gray-300">
									Drag and drop your images here, or
								</p>
								<label
									htmlFor="image-upload"
									className="mt-2 inline-block cursor-pointer rounded-md bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
								>
									Browse Files
									<input
										ref={fileInputRef}
										id="image-upload"
										type="file"
										name="image"
										accept="image/*"
										className="hidden"
										onChange={handleFileChange}
									/>
								</label>
							</div>
						)}
					</div>
					<div className="w-full text-center">
						<button
							type="submit"
							disabled={fetcher.state === "submitting"}
							className={`mt-4 rounded-md px-4 py-2 text-white ${
								fetcher.state === "submitting"
									? "bg-blue-400 cursor-not-allowed"
									: "bg-blue-500 hover:bg-blue-600"
							}`}
						>
							{fetcher.state === "submitting" ? "Uploading..." : "Upload"}
						</button>
					</div>
				</Form>

				{/* Image Grid */}
				<div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
					{data.images.map((image) => (
						<div
							key={image.id}
							className="overflow-hidden rounded-lg bg-white shadow-md transition-transform hover:scale-[1.02] dark:bg-gray-800"
						>
							<img
								src={image.url}
								alt={image.name}
								className="h-48 w-full object-cover"
							/>
							<div className="p-4">
								<h3 className="text-lg font-medium text-gray-900 dark:text-white">
									{image.name}
								</h3>
								{image.description && (
									<p className="mt-2 text-gray-600 dark:text-gray-300">
										{image.description}
									</p>
								)}
								<p className="mt-2 text-sm text-gray-500">
									{new Date(
										image.created_at
									).toLocaleDateString()}
								</p>
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
